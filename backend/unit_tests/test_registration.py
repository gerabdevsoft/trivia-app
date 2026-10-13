import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from test_timed_quiz import Collection, server


class RegistrationTests(unittest.TestCase):
    def test_password_registration_rejects_missing_faculty_or_documents(self):
        valid = dict(name="Persona de prueba", email="example@example.com", password="test-password",
                     faculty=server.FACULTIES[0], ci="123456")
        for changes in [{"faculty": ""}, {"faculty": "Invalid"}, {"ci": " "}, {"name": "  "}, {"password": "123"}]:
            with self.subTest(changes=changes):
                with self.assertRaises(ValueError):
                    server.RegisterBody(**{**valid, **changes})

    def test_google_profile_is_validated_even_before_verifying_token(self):
        for profile in [{"ci": "123"}, {"faculty": server.FACULTIES[0]}, {"faculty": "Invalid", "ci": "123"}]:
            with self.subTest(profile=profile):
                with self.assertRaises(ValueError):
                    server.GoogleAuthBody(id_token="fake-test-token", profile=profile)

    def google_call(self, documents, profile):
        users = Collection(documents)
        payload = {"iss": "https://accounts.google.com", "aud": "test-audience",
                   "email": "example@example.com", "email_verified": True, "name": "Persona de prueba", "sub": "test-sub"}
        body = server.GoogleAuthBody(id_token="fake-test-token", profile=profile)
        with patch.object(server, "db", SimpleNamespace(users=users, user_sessions=Collection())), \
             patch.object(server, "ALLOWED_GOOGLE_AUDIENCES", ["test-audience"]), \
             patch.object(server.google_id_token, "verify_oauth2_token", return_value=payload), \
             patch.object(server, "create_jwt", return_value="fake-test-session"):
            result = asyncio.run(server.auth_google(body))
        return users.documents, result

    def test_google_registration_saves_faculty_and_document(self):
        profile = {"faculty": server.FACULTIES[0], "ci": " 123456 ", "cu": None}
        documents, response = self.google_call([], profile)
        self.assertEqual(documents[0]["faculty"], profile["faculty"])
        self.assertEqual(documents[0]["ci"], "123456")
        self.assertTrue(response["user"]["profile_complete"])

    def test_existing_google_account_can_complete_profile(self):
        existing = {"user_id": "existing-test-user", "email": "example@example.com", "name": "Persona",
                    "total_points": 4, "is_admin": False, "is_active": True}
        profile = {"faculty": server.FACULTIES[0], "ci": None, "cu": "CU123"}
        documents, response = self.google_call([existing], profile)
        self.assertEqual(len(documents), 1)
        self.assertEqual(response["user"]["total_points"], 4)
        self.assertEqual(documents[0]["cu"], "CU123")
        self.assertTrue(response["user"]["profile_complete"])

    def test_google_login_without_registration_form_preserves_existing_profile(self):
        existing = {"user_id": "existing-test-user", "email": "example@example.com", "name": "Persona",
                    "total_points": 4, "is_admin": False, "is_active": True,
                    "faculty": server.FACULTIES[0], "ci": "123456"}
        documents, response = self.google_call([existing], None)
        self.assertEqual(documents[0]["ci"], "123456")
        self.assertEqual(documents[0]["faculty"], existing["faculty"])
        self.assertTrue(response["user"]["profile_complete"])
