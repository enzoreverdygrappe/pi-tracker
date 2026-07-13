"""Tests unitaires de scripts/common.py."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.common import (
    append_entry,
    make_empty_document,
    read_document,
    write_document_atomic,
)


def test_make_empty_document_has_expected_structure():
    # Act
    document = make_empty_document("claude_usage")

    # Assert
    assert document["category"] == "claude_usage"
    assert document["entries"] == []
    assert "updated_at" in document


def test_append_entry_returns_new_document_without_mutating_original():
    # Arrange
    original = make_empty_document("claude_usage")
    entry = {"timestamp": "2026-07-13T10:00:00+00:00", "calls": 5, "note": "test"}

    # Act
    updated = append_entry(original, entry)

    # Assert — l'original n'a pas bougé, la copie a l'entrée
    assert original["entries"] == []
    assert updated["entries"] == [entry]
    assert updated is not original
    assert updated["entries"] is not original["entries"]


def test_append_entry_rejects_non_dict_entry():
    with pytest.raises(TypeError):
        append_entry(make_empty_document("x"), "pas un dict")


def test_read_document_returns_empty_document_when_file_missing(tmp_path):
    # Act
    document = read_document(tmp_path / "absent.json", "claude_usage")

    # Assert
    assert document["category"] == "claude_usage"
    assert document["entries"] == []


def test_read_document_raises_on_corrupted_json(tmp_path):
    # Arrange
    path = tmp_path / "corrupt.json"
    path.write_text("{pas du json", encoding="utf-8")

    # Act / Assert
    with pytest.raises(ValueError, match="corrompu"):
        read_document(path, "claude_usage")


def test_read_document_raises_on_missing_entries_key(tmp_path):
    # Arrange
    path = tmp_path / "bad.json"
    path.write_text(json.dumps({"category": "x"}), encoding="utf-8")

    # Act / Assert
    with pytest.raises(ValueError, match="entries"):
        read_document(path, "x")


def test_write_document_atomic_roundtrip(tmp_path):
    # Arrange
    path = tmp_path / "sub" / "data.json"
    document = append_entry(
        make_empty_document("claude_usage"),
        {"timestamp": "2026-07-13T10:00:00+00:00", "calls": 3, "note": "été"},
    )

    # Act
    write_document_atomic(path, document)
    reloaded = read_document(path, "claude_usage")

    # Assert — écriture + relecture identiques (accents inclus)
    assert reloaded == document
    assert not list(path.parent.glob("*.tmp"))
