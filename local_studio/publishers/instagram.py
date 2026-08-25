from __future__ import annotations

from typing import Any

from instagram import instagram_publish


class InstagramPublisher:
    platform = "instagram"

    def publish(self, project: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        return instagram_publish(project, payload)
