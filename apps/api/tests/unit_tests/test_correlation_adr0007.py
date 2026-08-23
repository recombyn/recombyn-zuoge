"""ADR 0007 correlation + JSON log formatter."""

from __future__ import annotations

import json
import logging


def test_json_log_formatter_includes_extras():
    from app.main import _JsonLogFormatter

    record = logging.LogRecord(
        name="test.logger",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="hello %s",
        args=("world",),
        exc_info=None,
    )
    record.trace_id = "tid-1"
    record.job_id = "jid-1"
    record.event = "enqueued"
    line = _JsonLogFormatter().format(record)
    payload = json.loads(line)
    assert payload["msg"] == "hello world"
    assert payload["trace_id"] == "tid-1"
    assert payload["job_id"] == "jid-1"
    assert payload["event"] == "enqueued"
    assert payload["level"] == "INFO"
