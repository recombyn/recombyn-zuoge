"""Ensure PSD export dependencies resolve (pytoshop needs six)."""


def test_pytoshop_imports_with_six():
    import six  # noqa: F401
    from pytoshop.user.nested_layers import Image as PsdImage  # noqa: F401

    assert six is not None
