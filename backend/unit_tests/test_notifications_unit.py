import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import unittest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "notification_unit_tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


class FakePushClient:
    def __init__(self, status_code=200, error=None):
        self.status_code = status_code
        self.error = error
        self.calls = []

    async def post(self, path, json):
        self.calls.append((path, json))
        if self.error:
            raise self.error
        request = httpx.Request("POST", f"https://push.test{path}")
        status_code = self.status_code
        if isinstance(status_code, list):
            status_code = status_code[min(len(self.calls) - 1, len(status_code) - 1)]
        return httpx.Response(status_code, request=request)


class FakeCursor:
    def __init__(self, documents):
        self.documents = documents

    async def to_list(self, length):
        return self.documents[:length]


class FakeUsers:
    def __init__(self, users):
        self.users = users
        self.last_query = None

    def find(self, query, projection):
        self.last_query = query
        matched = [
            user for user in self.users
            if user.get("is_active") == query.get("is_active")
            and ("faculty" not in query or user.get("faculty") == query["faculty"])
        ]
        return FakeCursor([{"user_id": user["user_id"]} for user in matched])


class FakeDeliveries:
    def __init__(self):
        self.documents = {}

    async def insert_one(self, document):
        self.documents[document["notification_id"]] = dict(document)

    async def find_one(self, query, projection=None):
        document = self.documents.get(query.get("notification_id"))
        if not document:
            return None
        if query.get("status") and document.get("status") not in query["status"]["$in"]:
            return None
        recipient_field = "provider_accepted_recipients" if "provider_accepted_recipients" in query else "recipients"
        recipient = query.get(recipient_field)
        if recipient and recipient not in document.get(recipient_field, []):
            return None
        if projection:
            return {key: document[key] for key, enabled in projection.items() if enabled and key in document}
        return dict(document)

    async def update_one(self, query, update):
        document = self.documents.get(query.get("notification_id"))
        if document:
            for key, value in update.get("$set", {}).items():
                document[key] = value
            for key, value in update.get("$addToSet", {}).items():
                document.setdefault(key, [])
                if value not in document[key]:
                    document[key].append(value)


def run(coro):
    return asyncio.run(coro)


class NotificationTests(unittest.TestCase):
    def patch(self, target, name, value):
        original = getattr(target, name)
        setattr(target, name, value)
        self.addCleanup(setattr, target, name, original)

    def test_faculty_notification_only_targets_active_users_in_selected_faculty(self):
        faculty = server.FACULTIES[0]
        other_faculty = server.FACULTIES[1]
        users = FakeUsers([
            {"user_id": "faculty-a-1", "faculty": faculty, "is_active": True},
            {"user_id": "faculty-a-2", "faculty": faculty, "is_active": True},
            {"user_id": "faculty-b-1", "faculty": other_faculty, "is_active": True},
            {"user_id": "inactive-a", "faculty": faculty, "is_active": False},
        ])
        deliveries = FakeDeliveries()
        push = FakePushClient()
        self.patch(server, "db", SimpleNamespace(users=users, answers=None, notification_deliveries=deliveries))
        self.patch(server, "push_client", push)

        result = run(server.admin_send_notification(
            server.SendNotificationBody(title="Prueba", message="Mensaje", faculty=faculty),
            _admin={"is_admin": True},
        ))

        self.assertEqual(users.last_query, {"is_active": True, "faculty": faculty})
        self.assertEqual(len(push.calls), 1)
        self.assertEqual(push.calls[0][1]["recipients"], ["faculty-a-1", "faculty-a-2"])
        self.assertEqual(result["sent_to"], result["targeted_users"])
        self.assertEqual(result["targeted_users"], result["accepted_by_provider"])
        self.assertEqual(result["targeted_users"], 2)
        self.assertEqual(result["faculty"], faculty)
        self.assertEqual(push.calls[0][1]["data"]["notification_id"], result["notification_id"])
        self.assertEqual(deliveries.documents[result["notification_id"]]["status"], "accepted")

    def test_partial_batch_failure_is_saved_without_claiming_full_success(self):
        users = FakeUsers([
            {"user_id": f"user-{i}", "faculty": server.FACULTIES[0], "is_active": True}
            for i in range(101)
        ])
        deliveries = FakeDeliveries()
        push = FakePushClient(status_code=[200, 503])
        self.patch(server, "db", SimpleNamespace(users=users, answers=None, notification_deliveries=deliveries))
        self.patch(server, "push_client", push)

        with self.assertRaises(HTTPException) as error:
            run(server.admin_send_notification(
                server.SendNotificationBody(title="Prueba", message="Mensaje", faculty=server.FACULTIES[0]),
                _admin={"is_admin": True},
            ))
        self.assertEqual(error.exception.status_code, 502)
        self.assertEqual(len(push.calls), 2)
        delivery = next(iter(deliveries.documents.values()))
        self.assertEqual(delivery["status"], "partially_accepted")
        self.assertEqual(delivery["accepted_count"], 100)
        self.assertEqual(delivery["provider_accepted_recipients"], [f"user-{i}" for i in range(100)])

    def test_large_sends_are_split_into_provider_batches_of_at_most_100(self):
        push = FakePushClient()
        self.patch(server, "push_client", push)
        accepted = run(server.send_push(
            [f"user-{i}" for i in range(205)],
            {"title": "Prueba", "message": "Mensaje"},
            idempotency_key="batch-test",
        ))
        self.assertEqual(accepted, 205)
        self.assertEqual([len(call[1]["recipients"]) for call in push.calls], [100, 100, 5])
        self.assertEqual(len({call[1]["$idempotency_key"] for call in push.calls}), 3)

    def test_push_provider_rejections_are_reported_as_failures(self):
        for status_code in (401, 429, 500):
            with self.subTest(status_code=status_code):
                self.patch(server, "push_client", FakePushClient(status_code=status_code))
                with self.assertRaises(server.PushDispatchError) as error:
                    run(server.send_push(["test-user"], {"title": "Prueba", "message": "Mensaje"}))
                self.assertEqual(error.exception.accepted_recipients, [])

    def test_push_network_error_is_not_reported_as_success(self):
        self.patch(server, "push_client", FakePushClient(error=httpx.ConnectError("offline")))
        with self.assertRaises(server.PushDispatchError) as error:
            run(server.send_push(["test-user"], {"title": "Prueba", "message": "Mensaje"}))
        self.assertEqual(error.exception.accepted_recipients, [])

    def test_empty_recipient_list_does_not_call_provider(self):
        push = FakePushClient()
        self.patch(server, "push_client", push)
        self.assertEqual(run(server.send_push([], {"title": "Prueba", "message": "Mensaje"})), 0)
        self.assertEqual(push.calls, [])

    def test_invalid_faculties_are_rejected(self):
        for faculty in ("", "Facultad inventada"):
            with self.subTest(faculty=faculty):
                with self.assertRaises(ValueError):
                    server.SendNotificationBody(title="Prueba", message="Mensaje", faculty=faculty)

    def test_receipt_is_recorded_once_and_only_for_accepted_recipient(self):
        deliveries = FakeDeliveries()
        deliveries.documents["notification-test"] = {
            "notification_id": "notification-test",
            "status": "accepted",
            "provider_accepted_recipients": ["targeted-user"],
            "received_user_ids": [],
        }
        self.patch(server, "db", SimpleNamespace(notification_deliveries=deliveries))
        first = run(server.record_push_receipt(
            server.PushReceiptBody(notification_id="notification-test"),
            user={"user_id": "targeted-user"},
        ))
        second = run(server.record_push_receipt(
            server.PushReceiptBody(notification_id="notification-test"),
            user={"user_id": "targeted-user"},
        ))
        self.assertEqual(first, {"received": True, "already_received": False, "received_count": 1})
        self.assertEqual(second, {"received": True, "already_received": True, "received_count": 1})
        with self.assertRaises(HTTPException) as error:
            run(server.record_push_receipt(
                server.PushReceiptBody(notification_id="notification-test"),
                user={"user_id": "other-user"},
            ))
        self.assertEqual(error.exception.status_code, 404)

    def test_admin_status_reports_actual_receipt_count(self):
        deliveries = FakeDeliveries()
        deliveries.documents["notification-test"] = {
            "notification_id": "notification-test",
            "faculty": server.FACULTIES[0],
            "status": "accepted",
            "recipients": ["user-1", "user-2", "user-3"],
            "provider_accepted_recipients": ["user-1", "user-2", "user-3"],
            "received_user_ids": ["user-1", "user-2"],
            "accepted_count": 3,
            "created_at": server.now_utc(),
        }
        self.patch(server, "db", SimpleNamespace(notification_deliveries=deliveries))
        status = run(server.admin_notification_status("notification-test", _admin={"is_admin": True}))
        self.assertEqual(status["targeted_users"], 3)
        self.assertEqual(status["accepted_by_provider"], 3)
        self.assertEqual(status["received_count"], 2)
