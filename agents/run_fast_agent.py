#!/usr/bin/env python3
"""Copilot fast-agent bootstrap with local runtime model registrations."""

from __future__ import annotations

import json
import time
from collections.abc import Mapping, Sequence
from typing import Any

from fast_agent.cli.__main__ import main as fast_agent_main
from fast_agent.core.logging.logger import get_logger
from fast_agent.llm.model_database import ModelDatabase
from fast_agent.llm.model_factory import ModelFactory
from fast_agent.llm.provider_types import Provider

profiling_logger = get_logger("copilot.fast_agent.profiling")


def _to_jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if hasattr(value, "model_dump") and callable(value.model_dump):
        try:
            return _to_jsonable(value.model_dump())
        except Exception:
            return str(value)
    if isinstance(value, Mapping):
        return {str(key): _to_jsonable(item) for key, item in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_to_jsonable(item) for item in value]
    if hasattr(value, "__dict__"):
        try:
            return _to_jsonable(vars(value))
        except Exception:
            return str(value)
    return str(value)


def _measure_payload(value: Any) -> tuple[int, int]:
    try:
        serialized = json.dumps(_to_jsonable(value), ensure_ascii=False, default=str)
    except Exception:
        serialized = str(value)
    return len(serialized), len(serialized.encode("utf-8"))


def _extract_text_payload(content: Any) -> tuple[int, int, int]:
    blocks = content if isinstance(content, Sequence) and not isinstance(content, (str, bytes, bytearray)) else []
    text_parts: list[str] = []
    for block in blocks:
      text = getattr(block, "text", None)
      if isinstance(text, str) and text:
          text_parts.append(text)
    merged = "\n".join(text_parts)
    return len(merged), len(merged.encode("utf-8")), len(blocks)


def _extract_final_response_text(final_response: Any) -> str:
    if final_response is None:
        return ""

    direct_text = getattr(final_response, "output_text", None)
    if isinstance(direct_text, str) and direct_text.strip():
        return direct_text.strip()

    output_items = list(getattr(final_response, "output", []) or [])
    text_parts: list[str] = []

    def _push_text(value: Any) -> None:
        if isinstance(value, str):
            trimmed = value.strip()
            if trimmed:
                text_parts.append(trimmed)

    for item in output_items:
        item_type = getattr(item, "type", None)
        if item_type in {"message", "output_text", "text"}:
            _push_text(getattr(item, "text", None))
            for part in list(getattr(item, "content", []) or []):
                _push_text(getattr(part, "text", None))
                _push_text(getattr(part, "output_text", None))

    return "\n".join(text_parts).strip()


def _estimate_tokens(*, json_bytes: int, text_chars: int) -> int | None:
    basis = max(json_bytes / 4.0, text_chars / 4.0)
    if basis <= 0:
        return 0
    return int(basis)


def register_copilot_runtime_models() -> None:
    gpt53_codex = ModelDatabase.get_model_params("gpt-5.3-codex")
    if gpt53_codex is None:
        return

    gpt54_codex = gpt53_codex.model_copy(
        update={
            # Conservative parity with observed Codex CLI effective window (~950K), not a speculative 1,000,000.
            "context_window": 950_000,
            "default_provider": Provider.CODEX_RESPONSES,
        }
    )

    ModelDatabase.register_runtime_model_params("gpt-5.4", gpt54_codex)
    ModelFactory.MODEL_ALIASES.setdefault("gpt54", "codexresponses.gpt-5.4")
    ModelFactory.MODEL_ALIASES.setdefault("codex54", "codexresponses.gpt-5.4")

    gpt54mini_codex = gpt53_codex.model_copy(
        update={
            "default_provider": Provider.CODEX_RESPONSES,
        }
    )

    ModelDatabase.register_runtime_model_params("gpt-5.4-mini", gpt54mini_codex)
    ModelFactory.MODEL_ALIASES.setdefault("gpt54mini", "codexresponses.gpt-5.4-mini")
    ModelFactory.MODEL_ALIASES.setdefault("codex54mini", "codexresponses.gpt-5.4-mini")


def install_profiling_hooks() -> None:
    from fast_agent.agents.llm_decorator import LlmDecorator
    from fast_agent.llm.fastagent_llm import FastAgentLLM
    from fast_agent.llm.provider.openai import openresponses_streaming, responses_streaming, streaming_utils
    from fast_agent.llm.provider.openai.openresponses_streaming import OpenResponsesStreamingMixin
    from fast_agent.llm.provider.openai.responses_streaming import ResponsesStreamingMixin
    from fast_agent.llm.stream_types import StreamChunk
    from fast_agent.mcp import mcp_aggregator

    original_finalize = streaming_utils.finalize_stream_response
    original_call_tool = mcp_aggregator.MCPAggregator.call_tool
    original_notify_stream_listeners = FastAgentLLM._notify_stream_listeners
    original_openresponses_process_stream = OpenResponsesStreamingMixin._process_stream
    original_responses_process_stream = ResponsesStreamingMixin._process_stream
    original_generate_with_summary = LlmDecorator._generate_with_summary

    def profiled_finalize_stream_response(*, final_response: Any, model: str, agent_name: str | None, chat_turn, logger, notified_tool_indices, emit_tool_fallback) -> None:
        original_finalize(
            final_response=final_response,
            model=model,
            agent_name=agent_name,
            chat_turn=chat_turn,
            logger=logger,
            notified_tool_indices=notified_tool_indices,
            emit_tool_fallback=emit_tool_fallback,
        )
        usage = getattr(final_response, "usage", None)
        input_tokens = getattr(usage, "input_tokens", 0) or 0
        output_tokens = getattr(usage, "output_tokens", 0) or 0
        profiling_logger.info(
            "LLM turn profiling",
            data={
                "agent_name": agent_name,
                "model": model,
                "chat_turn": chat_turn(),
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "configured_context_window": ModelDatabase.get_context_window(model),
                "observed_model_context_window": None,
            },
        )

    async def profiled_call_tool(self, name: str, arguments: dict | None = None, tool_use_id: str | None = None, *, request_tool_handler=None):
        started = time.monotonic()
        server_name = ""
        local_tool_name = name
        if "__" in name:
            server_name, local_tool_name = name.split("__", 1)
        try:
            result = await original_call_tool(
                self,
                name,
                arguments,
                tool_use_id,
                request_tool_handler=request_tool_handler,
            )
            duration_ms = int((time.monotonic() - started) * 1000)
            json_chars, json_bytes = _measure_payload(result)
            text_chars, text_bytes, block_count = _extract_text_payload(getattr(result, "content", None))
            profiling_logger.info(
                "Inner MCP tool profiling",
                data={
                    "agent_name": getattr(self, "agent_name", None),
                    "server_name": server_name or None,
                    "tool_name": local_tool_name,
                    "tool_name_raw": name,
                    "tool_use_id": tool_use_id,
                    "tool_result_json_chars": json_chars,
                    "tool_result_json_bytes": json_bytes,
                    "tool_content_text_chars": text_chars,
                    "tool_content_text_bytes": text_bytes,
                    "tool_content_block_count": block_count,
                    "tool_result_token_estimate": _estimate_tokens(json_bytes=json_bytes, text_chars=text_chars),
                    "tool_is_error": bool(getattr(result, "isError", False)),
                    "duration_ms": duration_ms,
                    "status": "ok",
                },
            )
            return result
        except Exception as exc:
            duration_ms = int((time.monotonic() - started) * 1000)
            profiling_logger.info(
                "Inner MCP tool profiling",
                data={
                    "agent_name": getattr(self, "agent_name", None),
                    "server_name": server_name or None,
                    "tool_name": local_tool_name,
                    "tool_name_raw": name,
                    "tool_use_id": tool_use_id,
                    "duration_ms": duration_ms,
                    "status": "exception",
                    "error": str(exc),
                },
            )
            raise

    def profiled_notify_stream_listeners(self, chunk):  # type: ignore[no-untyped-def]
        if getattr(chunk, "text", None) and not getattr(chunk, "is_reasoning", False):
            setattr(self, "_copilot_stream_had_text", True)
            chunks = list(getattr(self, "_copilot_stream_text_chunks", []) or [])
            chunks.append(chunk.text)
            setattr(self, "_copilot_stream_text_chunks", chunks)
        return original_notify_stream_listeners(self, chunk)

    async def _inject_fallback_text_if_needed(self, final_response):  # type: ignore[no-untyped-def]
        if getattr(self, "_copilot_stream_had_text", False):
            return
        fallback_text = _extract_final_response_text(final_response)
        if not fallback_text:
            return
        chunks = list(getattr(self, "_copilot_stream_text_chunks", []) or [])
        chunks.append(fallback_text)
        setattr(self, "_copilot_stream_text_chunks", chunks)
        original_notify_stream_listeners(self, StreamChunk(text=fallback_text, is_reasoning=False))
        setattr(self, "_copilot_stream_had_text", True)
        profiling_logger.info(
            "Injected fallback stream text from final_response",
            data={
                "agent_name": getattr(self, "name", None),
                "model": getattr(final_response, "model", None),
                "fallback_text_chars": len(fallback_text),
                "fallback_text_bytes": len(fallback_text.encode("utf-8")),
            },
        )

    async def profiled_openresponses_process_stream(self, stream, model, capture_filename):  # type: ignore[no-untyped-def]
        setattr(self, "_copilot_stream_had_text", False)
        setattr(self, "_copilot_stream_text_chunks", [])
        final_response, reasoning_segments = await original_openresponses_process_stream(self, stream, model, capture_filename)
        await _inject_fallback_text_if_needed(self, final_response)
        return final_response, reasoning_segments

    async def profiled_responses_process_stream(self, stream, model, capture_filename):  # type: ignore[no-untyped-def]
        setattr(self, "_copilot_stream_had_text", False)
        setattr(self, "_copilot_stream_text_chunks", [])
        final_response, reasoning_segments = await original_responses_process_stream(self, stream, model, capture_filename)
        await _inject_fallback_text_if_needed(self, final_response)
        return final_response, reasoning_segments

    async def profiled_generate_with_summary(self, messages, request_params=None, tools=None):  # type: ignore[no-untyped-def]
        response, summary = await original_generate_with_summary(self, messages, request_params, tools)
        llm = getattr(self, "_llm", None)
        buffered_chunks = list(getattr(llm, "_copilot_stream_text_chunks", []) or [])
        if hasattr(response, "last_text") and callable(response.last_text):
            last_text = response.last_text() or ""
            if not last_text and buffered_chunks and hasattr(response, "add_text") and callable(response.add_text):
                fallback_text = "".join(chunk for chunk in buffered_chunks if isinstance(chunk, str)).strip()
                if fallback_text:
                    response.add_text(fallback_text)
                    profiling_logger.info(
                        "Injected fallback assistant message text into PromptMessageExtended",
                        data={
                            "agent_name": getattr(self, "_name", None),
                            "fallback_text_chars": len(fallback_text),
                            "fallback_text_bytes": len(fallback_text.encode("utf-8")),
                        },
                    )
        return response, summary

    streaming_utils.finalize_stream_response = profiled_finalize_stream_response
    responses_streaming.finalize_stream_response = profiled_finalize_stream_response
    openresponses_streaming.finalize_stream_response = profiled_finalize_stream_response
    mcp_aggregator.MCPAggregator.call_tool = profiled_call_tool
    FastAgentLLM._notify_stream_listeners = profiled_notify_stream_listeners
    OpenResponsesStreamingMixin._process_stream = profiled_openresponses_process_stream
    ResponsesStreamingMixin._process_stream = profiled_responses_process_stream
    LlmDecorator._generate_with_summary = profiled_generate_with_summary


if __name__ == "__main__":
    register_copilot_runtime_models()
    install_profiling_hooks()
    fast_agent_main()
