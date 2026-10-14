import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from test_timed_quiz import server


class FakeCollection:
    def __init__(self):
        self.documents = []

    async def create_index(self, *args, **kwargs):
        return None

    async def delete_many(self, query):
        return SimpleNamespace(deleted_count=0)

    async def find_one(self, query):
        return None

    async def insert_one(self, document):
        self.documents.append(document)

    async def count_documents(self, query):
        return 0

    async def insert_many(self, documents):
        self.documents.extend(documents)


class EmptyDatabase:
    def __init__(self):
        self.collections = {}

    async def list_collection_names(self):
        return []

    def __getattr__(self, name):
        return self.collections.setdefault(name, FakeCollection())


class StartupTests(unittest.TestCase):
    def test_existing_database_skips_all_startup_initialization(self):
        class ExistingDatabase:
            async def list_collection_names(self):
                return ["users", "questions"]

            def __getattr__(self, name):
                raise AssertionError(f"Startup unexpectedly accessed db.{name}")

        with patch.object(server, "db", ExistingDatabase()):
            result = asyncio.run(server.on_startup())

        self.assertIsNone(result)

    def test_empty_database_runs_first_time_initialization(self):
        db = EmptyDatabase()
        with patch.object(server, "db", db), patch.object(
            server, "hash_password", return_value="test-password-hash"
        ):
            asyncio.run(server.on_startup())

        self.assertEqual(len(db.users.documents), 1)
        self.assertEqual(len(db.settings.documents), 1)
        self.assertEqual(len(db.questions.documents), 8)
