"""Run with: python -m unittest test_resilience -v (no real API calls)."""
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

os.environ.setdefault("GROQ_API_KEY", "test-only")
os.environ.setdefault("TAVILY_API_KEY", "test-only")
os.environ["OTEL_SDK_DISABLED"] = "true"
os.environ["CREWAI_TRACING_ENABLED"] = "false"
os.environ["CREWAI_STORAGE_DIR"] = tempfile.mkdtemp(prefix="klarity-tests-")

from fastapi.testclient import TestClient
from litellm.exceptions import RateLimitError
import api_server as api


def limited(message="Please try again in 14.2725s."):
    return RateLimitError(message=message, llm_provider="groq", model="openai/gpt-oss-20b")


class ResilienceTests(unittest.TestCase):
    def test_provider_cooldown_message_and_header(self):
        self.assertAlmostEqual(api.retry_delay(limited(), 0), 15.2725)
        self.assertEqual(api.retry_delay(limited("Try again in 1m2.5s."), 0), 63.5)
        error = limited()
        error.response = SimpleNamespace(headers={"retry-after": "20"})
        self.assertEqual(api.retry_delay(error, 0), 21)

    def test_malformed_cooldown_uses_bounded_backoff(self):
        error = limited("Slow down")
        error.response = SimpleNamespace(headers={"retry-after": "nan"})
        self.assertEqual(api.retry_delay(error, 1), 20)

    def test_rate_limit_retries_same_call_then_succeeds(self):
        messages = [{"role": "user", "content": "Classify astronomy"}]
        with patch.object(api.LLM, "call", side_effect=[limited(), "Astronomy"]) as call, \
             patch.object(api.time, "sleep") as sleep:
            self.assertEqual(api.groq_llm.call(messages, tools=[]), "Astronomy")
        self.assertEqual(call.call_count, 2)
        self.assertEqual(call.call_args_list[0], call.call_args_list[1])
        sleep.assert_called_once_with(15.2725)

    def test_retries_stop_after_three(self):
        with patch.object(api.LLM, "call", side_effect=limited()) as call, \
             patch.object(api.time, "sleep") as sleep:
            with self.assertRaises(RateLimitError):
                api.groq_llm.call("topic")
        self.assertEqual(call.call_count, 4)
        self.assertEqual(sleep.call_count, 3)

    def test_long_cooldown_does_not_block_worker(self):
        with patch.object(api.LLM, "call", side_effect=limited("Try again in 2h3m4s.")), \
             patch.object(api.time, "sleep") as sleep:
            with self.assertRaises(RateLimitError):
                api.groq_llm.call("topic")
        sleep.assert_not_called()

    def test_non_rate_limit_error_is_not_retried(self):
        with patch.object(api.LLM, "call", side_effect=ValueError("Invalid credentials")) as call, \
             patch.object(api.time, "sleep") as sleep:
            with self.assertRaises(ValueError):
                api.groq_llm.call("topic")
        call.assert_called_once()
        sleep.assert_not_called()

    def test_fresh_crew_keeps_retry_llm(self):
        fresh = api.build_crew()
        self.assertIsNot(fresh.agents[0], api.build_crew().agents[0])
        self.assertTrue(all(isinstance(agent.llm, api.RetryingGroqLLM) for agent in fresh.agents))

    def test_api_success_and_validation(self):
        client = TestClient(api.app)
        with patch.object(api, "build_crew", return_value=Mock(kickoff=Mock(return_value="Research result"))) as copy:
            response = client.post("/validate", json={"topic": "Astronomy"})
            self.assertEqual(response.json(), {"result": "Research result"})
            self.assertEqual(response.status_code, 200)
            copy.return_value.kickoff.assert_called_once_with(inputs={"topic": "Astronomy"})
        self.assertEqual(client.post("/validate", json={"topic": "x"}).status_code, 422)
        self.assertEqual(client.post("/validate", json={"topic": "x" * 301}).status_code, 422)
        self.assertFalse(api.research_lock.locked())

    def test_busy_request_does_not_start_another_crew(self):
        api.research_lock.acquire()
        try:
            with patch.object(api, "build_crew") as copy:
                response = TestClient(api.app).post("/validate", json={"topic": "Astronomy"})
            self.assertEqual(response.status_code, 429)
            self.assertEqual(response.headers["retry-after"], "20")
            copy.assert_not_called()
        finally:
            api.research_lock.release()

    def test_exhaustion_returns_429_and_releases_worker(self):
        with patch.object(api, "build_crew", return_value=Mock(kickoff=Mock(side_effect=limited()))):
            response = TestClient(api.app).post("/validate", json={"topic": "Astronomy"})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers["retry-after"], "16")
        self.assertNotIn("GroqException", response.text)
        self.assertFalse(api.research_lock.locked())


if __name__ == "__main__":
    unittest.main()
