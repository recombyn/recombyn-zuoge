"""Bootstrap design catalog when DB is empty.

Prompts/rules are not shipped in the repo — Admin must configure them (or restore a DB dump).
"""

from __future__ import annotations

import logging

from sqlmodel import Session

from app import crud
from app.core import db as core_db

logger = logging.getLogger(__name__)


def seed_design_catalog_if_empty() -> None:
    """Legacy check — runtime skills are upserted by ``ensure_design_skills``."""
    with Session(core_db.engine) as session:
        n = crud.count_design_skills(session=session)
    if n <= 0:
        logger.warning(
            "design_skill is empty before ensure_design_skills — "
            "will load file packs from seeds/design_skills on catalog boot."
        )
