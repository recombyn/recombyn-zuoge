"""Shared API + DB models.

``table=True`` classes are the SQLModel schema surface. DDL is applied by Alembic
(``app/alembic``, via ``init_schema()`` → ``run_migrations()``).
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import ConfigDict
from sqlalchemy import BigInteger, Column, LargeBinary, Text
from sqlmodel import Field, SQLModel


# ----- Generic / API response (non-table) -----


class Message(SQLModel):
    message: str


class AuthConfigOut(SQLModel):
    googleEnabled: bool
    googleClientId: str | None = None
    emailEnabled: bool
    # Platform credit wallet (WALLET_BILLING_ENABLED); default off until Cloud sets true.
    billingEnabled: bool = False



class UserPublic(SQLModel):
    model_config = ConfigDict(extra="allow")

    id: str
    email: str | None = None
    name: str | None = None
    avatar: str | None = None
    provider: str | None = None
    role: str | None = None
    bio: str | None = None


class AuthSessionOut(SQLModel):
    user: UserPublic
    token: str


class AuthMeOut(SQLModel):
    user: UserPublic


class OkOut(SQLModel):
    ok: bool = True


class BatchDeleteOut(SQLModel):
    ok: bool = True
    deleted: int | list[Any] = 0


class ProjectOneOut(SQLModel):
    model_config = ConfigDict(extra="allow")

    project: dict[str, Any]


class ProjectListOut(SQLModel):
    model_config = ConfigDict(extra="allow")

    items: list[dict[str, Any]] | None = None
    projects: list[dict[str, Any]] | None = None
    page: int | None = None
    pageSize: int | None = None
    total: int | None = None
    hasMore: bool | None = None


class IdsOut(SQLModel):
    ids: list[str]


class ItemsOut(SQLModel):
    model_config = ConfigDict(extra="allow")

    items: list[Any] = Field(default_factory=list)


class ItemOut(SQLModel):
    model_config = ConfigDict(extra="allow")

    item: dict[str, Any]


# ----- DB tables (existing schema) -----


class User(SQLModel, table=True):
    """Maps ``users`` — id is string (not UUID) to match product rows."""

    __tablename__ = "users"

    id: str = Field(primary_key=True, max_length=64)
    email: str = Field(index=True, max_length=320)
    name: str = Field(default="", max_length=255)
    avatar: Optional[str] = Field(default=None)
    default_avatar: Optional[str] = Field(default=None)
    bio: Optional[str] = Field(default=None)
    provider: str = Field(default="email", max_length=32)
    google_sub: Optional[str] = Field(default=None, max_length=128)
    password_hash: Optional[str] = Field(default=None, max_length=128)
    password_salt: Optional[str] = Field(default=None, max_length=64)
    role: str = Field(default="user", max_length=16)
    status: str = Field(default="active", max_length=16)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)


class Org(SQLModel, table=True):
    """Team / tenant container (RBAC Phase 6+)."""

    __tablename__ = "orgs"

    id: str = Field(primary_key=True, max_length=64)
    name: str = Field(default="Untitled org", max_length=120)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)


class OrgMember(SQLModel, table=True):
    """Maps user ↔ org with role owner|admin|member."""

    __tablename__ = "org_members"

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: str = Field(index=True, max_length=64)
    user_id: str = Field(index=True, max_length=64)
    role: str = Field(default="member", max_length=16)
    created_at: float = Field(default=0.0)


class OrgInvite(SQLModel, table=True):
    """Pending / resolved org invitation (accept before membership)."""

    __tablename__ = "org_invites"

    id: str = Field(primary_key=True, max_length=64)
    org_id: str = Field(index=True, max_length=64)
    email: Optional[str] = Field(default=None, index=True, max_length=320)
    user_id: Optional[str] = Field(default=None, index=True, max_length=64)
    role: str = Field(default="member", max_length=16)
    status: str = Field(default="pending", index=True, max_length=16)
    invited_by: str = Field(max_length=64)
    created_at: float = Field(default=0.0)
    responded_at: Optional[float] = Field(default=None)


class AuthSession(SQLModel, table=True):
    """Maps ``auth_sessions`` — bearer token primary key."""

    __tablename__ = "auth_sessions"

    token: str = Field(primary_key=True, max_length=128)
    user_id: str = Field(index=True, max_length=64)
    expires_at: float
    created_at: float


class Project(SQLModel, table=True):
    """Maps ``projects`` core columns (extra migration columns ignored by ORM)."""

    __tablename__ = "projects"

    id: str = Field(primary_key=True, max_length=64)
    user_id: str = Field(index=True, max_length=64)
    """Optional team container — members may read/write per org role."""
    org_id: Optional[str] = Field(default=None, index=True, max_length=64)
    name: str = Field(default="Untitled", max_length=255)
    # Collage may store ≤4 https URLs as a JSON array — must be TEXT, not VARCHAR(512).
    thumbnail_key: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    thumbnail_custom: int = Field(default=0)
    document_key: Optional[str] = Field(default=None, max_length=512)
    document_json: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    revision: int = Field(default=1)
    updated_at: float = Field(default=0.0)
    created_at: float = Field(default=0.0)


class UserBalance(SQLModel, table=True):
    """Maps ``user_balances`` — unified 积分 wallet."""

    __tablename__ = "user_balances"

    user_id: str = Field(primary_key=True, max_length=64)
    credits: int = Field(default=0)
    plan_id: str = Field(default="free", max_length=16)
    plan_expires_at: Optional[float] = Field(default=None)
    updated_at: float = Field(default=0.0)


class WalletLedger(SQLModel, table=True):
    """Maps ``wallet_ledger``."""

    __tablename__ = "wallet_ledger"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: str = Field(index=True, max_length=64)
    kind: str = Field(max_length=16)
    amount: int = 0
    balance_after: int = 0
    detail: Optional[str] = Field(default=None)
    card_key_id: Optional[int] = Field(default=None)
    created_at: float = Field(default=0.0)


class PlazaSubmission(SQLModel, table=True):
    """Maps ``plaza_submissions`` (list/detail fields; large JSON optional)."""

    __tablename__ = "plaza_submissions"

    id: str = Field(primary_key=True, max_length=64)
    project_id: str = Field(max_length=64)
    user_id: str = Field(index=True, max_length=64)
    author_name: str = Field(default="", max_length=255)
    author_avatar: Optional[str] = Field(default=None)
    title: str = Field(default="", max_length=255)
    category: str = Field(default="resume", max_length=32)
    document_json: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    document_key: Optional[str] = Field(default=None, max_length=512)
    cover_json: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    cover_image_url: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    custom_cover_image_url: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    panel_urls_json: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    status: str = Field(default="pending", max_length=16)
    reject_reason: Optional[str] = Field(default=None)
    like_count: int = Field(default=0)
    use_count: int = Field(default=0)
    is_visible: int = Field(default=1)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)
    reviewed_at: Optional[float] = Field(default=None)
    reviewed_by: Optional[str] = Field(default=None, max_length=64)


class PlazaLike(SQLModel, table=True):
    __tablename__ = "plaza_likes"

    user_id: str = Field(primary_key=True, max_length=64)
    submission_id: str = Field(primary_key=True, max_length=64)
    created_at: float = Field(default=0.0)


class EmailCode(SQLModel, table=True):
    __tablename__ = "email_codes"

    email: str = Field(primary_key=True, max_length=320)
    code_hash: str = Field(max_length=128)
    # Unix seconds as BIGINT — MySQL FLOAT lacks second precision; DOUBLE is ok but
    # integer seconds match the OTP TTL math and avoid float edge cases.
    expires_at: int = Field(default=0, sa_column=Column(BigInteger, nullable=False))
    sent_at: int = Field(default=0, sa_column=Column(BigInteger, nullable=False))
    attempts: int = Field(default=0)


class EmailTicket(SQLModel, table=True):
    __tablename__ = "email_tickets"

    ticket: str = Field(primary_key=True, max_length=128)
    email: str = Field(max_length=320)
    expires_at: int = Field(default=0, sa_column=Column(BigInteger, nullable=False))


class EmailActivateToken(SQLModel, table=True):
    __tablename__ = "email_activate_tokens"

    token_id: str = Field(primary_key=True, max_length=64)
    email: str = Field(index=True, max_length=320)
    expires_at: int = Field(default=0, sa_column=Column(BigInteger, nullable=False))
    created_at: int = Field(default=0, sa_column=Column(BigInteger, nullable=False))


class CardKey(SQLModel, table=True):
    __tablename__ = "card_keys"

    id: Optional[int] = Field(default=None, primary_key=True)
    key_hash: str = Field(index=True, unique=True, max_length=128)
    credits: int = 0
    kind: str = Field(default="credit", max_length=16)
    plan_id: Optional[str] = Field(default=None, max_length=16)
    status: str = Field(default="unused", max_length=16)
    expires_at: Optional[float] = Field(default=None)
    created_at: float = Field(default=0.0)
    redeemed_by: Optional[str] = Field(default=None, max_length=64)
    redeemed_at: Optional[float] = Field(default=None)


class Asset(SQLModel, table=True):
    __tablename__ = "assets"

    id: str = Field(primary_key=True, max_length=64)
    user_id: str = Field(index=True, max_length=64)
    kind: str = Field(max_length=16)
    object_key: Optional[str] = Field(default=None, max_length=512)
    url: str = Field(default="")
    mime: Optional[str] = Field(default=None, max_length=128)
    width: Optional[int] = Field(default=None)
    height: Optional[int] = Field(default=None)
    source: str = Field(default="ai_image", max_length=32)
    prompt: Optional[str] = Field(default=None)
    meta_json: Optional[str] = Field(default=None)
    created_at: float = Field(default=0.0)


class DesignStageReview(SQLModel, table=True):
    __tablename__ = "design_stage_review"

    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: str = Field(max_length=64)
    user_id: str = Field(max_length=64)
    scene: Optional[str] = Field(default=None, max_length=32)
    skill_index: int = Field(default=0)
    skill_id: Optional[int] = Field(default=None)
    skill_name: Optional[str] = Field(default=None, max_length=128)
    skill_category: Optional[str] = Field(default=None, max_length=32)
    rating: int = Field(default=0)
    verdict: str = Field(default="pass", max_length=32)
    comment: Optional[str] = Field(default=None)
    preview_svg: Optional[str] = Field(default=None)
    tokens: int = Field(default=0)
    model_actual: Optional[str] = Field(default=None, max_length=64)
    created_at: float = Field(default=0.0)


class DesignDict(SQLModel, table=True):
    __tablename__ = "design_dict"

    id: Optional[int] = Field(default=None, primary_key=True)
    dict_type: str = Field(index=True, max_length=32)
    code: str = Field(max_length=64)
    label: str = Field(max_length=128)
    description: Optional[str] = Field(default=None)
    sort_order: int = Field(default=0)
    enabled: int = Field(default=1)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)


class DesignTask(SQLModel, table=True):
    __tablename__ = "design_task"

    id: str = Field(primary_key=True, max_length=64)
    user_id: str = Field(index=True, max_length=64)
    canvas_id: Optional[str] = Field(default=None, max_length=64)
    scene: Optional[str] = Field(default=None, max_length=32)
    skill_group_id: Optional[int] = Field(default=None)
    task_type: str = Field(max_length=32)
    user_selected_model: Optional[str] = Field(default=None, max_length=64)
    actual_models: Optional[str] = Field(default=None)
    target_layer_id: Optional[str] = Field(default=None, max_length=128)
    current_skill_index: int = Field(default=0)
    status: str = Field(default="queued", max_length=32)
    hold_credits: int = Field(default=0)
    charged_credits: int = Field(default=0)
    total_tokens: int = Field(default=0)
    prompt: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    canvas_size: Optional[str] = Field(default=None, max_length=64)
    result_svg: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    error_message: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    # MySQL maps bare str → VARCHAR(255); worker_snapshot JSON exceeds that.
    meta_json: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)


class DesignTaskEvent(SQLModel, table=True):
    """Replayable UI timeline event; deliberately independent from task metadata."""
    __tablename__ = "design_task_event"

    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: str = Field(index=True, max_length=64)
    event_json: str = Field(sa_column=Column(Text, nullable=False))
    created_at: float = Field(default=0.0)


class DesignTaskCanvasCommand(SQLModel, table=True):
    """Durable canvas command outbox. Acknowledgement is task-global for now."""
    __tablename__ = "design_task_canvas_command"

    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: str = Field(index=True, max_length=64)
    command_json: str = Field(sa_column=Column(Text, nullable=False))
    created_at: float = Field(default=0.0)
    acknowledged_at: Optional[float] = Field(default=None)


class DesignLayerLock(SQLModel, table=True):
    __tablename__ = "design_layer_lock"

    id: Optional[int] = Field(default=None, primary_key=True)
    canvas_id: str = Field(index=True, max_length=64)
    layer_id: str = Field(max_length=128)
    locked: int = Field(default=1)
    allowed_skills: Optional[str] = Field(default=None)
    forbidden_attrs: Optional[str] = Field(default=None)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)



class DesignTokenPack(SQLModel, table=True):
    __tablename__ = "design_token_pack"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(max_length=128)
    scenes: str = Field(default="all", max_length=128)
    tokens_json: str = Field(default="")
    is_default: int = Field(default=0)
    sort_order: int = Field(default=0)
    enabled: int = Field(default=1)
    note: Optional[str] = Field(default=None)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)


class DesignSystemPrompt(SQLModel, table=True):
    __tablename__ = "design_system_prompt"

    id: Optional[int] = Field(default=None, primary_key=True)
    prompt_key: str = Field(max_length=128, unique=True)
    label: str = Field(default="", max_length=128)
    description: Optional[str] = Field(default=None)
    # MySQL maps bare str → VARCHAR(255); seed bodies exceed that.
    body: str = Field(default="", sa_column=Column(Text, nullable=False))
    group_key: str = Field(default="agent_prompt", max_length=32)
    selectable: int = Field(default=0)
    sort_order: int = Field(default=0)
    enabled: int = Field(default=1)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)


class DesignPromptPack(SQLModel, table=True):
    __tablename__ = "design_prompt_pack"

    id: Optional[int] = Field(default=None, primary_key=True)
    kind: str = Field(max_length=128)
    pack_type: str = Field(default="need", max_length=32)
    title: str = Field(max_length=128)
    # MySQL maps bare str → VARCHAR(255); packs/skills need TEXT.
    body: str = Field(default="", sa_column=Column(Text, nullable=False))
    when_to_use: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    scenes: str = Field(default="all", max_length=128)
    used_by: str = Field(default="", max_length=256)
    sort_order: int = Field(default=0)
    enabled: int = Field(default=1)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)


class DesignSkill(SQLModel, table=True):
    __tablename__ = "design_skill"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(max_length=128)
    skill_key: Optional[str] = Field(default=None, max_length=64)
    category: str = Field(max_length=32)
    prompt_positive: str = Field(default="", sa_column=Column(Text, nullable=False))
    prompt_negative: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    when_to_use: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    preferred_tools: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    allowed_resources: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    triggers: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    mutex_group: Optional[str] = Field(default=None, max_length=64)
    version: int = Field(default=1)
    pack_version: Optional[str] = Field(default=None, max_length=32)
    description: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    logo: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    locales: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    source: str = Field(default="admin", max_length=16)
    namespace: str = Field(default="user", max_length=16)
    owner_user_id: Optional[str] = Field(default=None, max_length=64)
    input_schema: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    output_schema: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    sort_weight: int = Field(default=0)
    scenes: str = Field(default="all", max_length=128)
    default_model: str = Field(default="doubao", max_length=32)
    max_retries: int = Field(default=2)
    enabled: int = Field(default=1)
    output_format: str = Field(default="json", max_length=64)
    allow_user_model_override: int = Field(default=0)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)


class DesignSkillRevision(SQLModel, table=True):
    __tablename__ = "design_skill_revision"

    id: Optional[int] = Field(default=None, primary_key=True)
    skill_id: int = Field(default=0)
    skill_key: str = Field(max_length=64)
    namespace: str = Field(default="user", max_length=16)
    version: int = Field(default=1)
    pack_version: Optional[str] = Field(default=None, max_length=32)
    snapshot: str = Field(default="", sa_column=Column(Text, nullable=False))
    source: str = Field(default="admin", max_length=16)
    created_at: float = Field(default=0.0)


class DesignUserSkillPref(SQLModel, table=True):
    __tablename__ = "design_user_skill_pref"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: str = Field(max_length=64)
    skill_key: str = Field(max_length=64)
    enabled: int = Field(default=1)
    updated_at: float = Field(default=0.0)


class Font(SQLModel, table=True):
    __tablename__ = "fonts"

    id: str = Field(primary_key=True, max_length=64)
    family: str = Field(max_length=255)
    display_name: str = Field(max_length=255)
    faces_json: str = Field(default="[]")
    sort_order: int = Field(default=0)
    created_at: float = Field(default=0.0)
    owner_user_id: Optional[str] = Field(default=None, max_length=64, index=True)


class Notice(SQLModel, table=True):
    __tablename__ = "notices"

    id: str = Field(primary_key=True, max_length=64)
    kind: str = Field(default="announcement", max_length=16)
    title: str = Field(max_length=255)
    body: str = Field(default="")
    status: str = Field(default="draft", max_length=16)
    published_at: Optional[float] = Field(default=None)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)


class AppMigration(SQLModel, table=True):
    __tablename__ = "app_migrations"

    id: str = Field(primary_key=True, max_length=64)
    applied_at: float = Field(default=0.0)


class DocumentShare(SQLModel, table=True):
    __tablename__ = "document_shares"

    id: str = Field(primary_key=True, max_length=64)
    owner_id: str = Field(index=True, max_length=64)
    name: str = Field(max_length=255)
    permission: str = Field(max_length=16)
    document_json: str = Field(default="", sa_column=Column(Text, nullable=False))
    source_project_id: Optional[str] = Field(default=None, max_length=64)
    editor_user_ids: Optional[str] = Field(default=None)
    viewer_user_ids: Optional[str] = Field(default=None)
    link_enabled: int = Field(default=1)
    link_public: int = Field(default=0)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)


class ChatSession(SQLModel, table=True):
    __tablename__ = "chat_sessions"

    id: str = Field(primary_key=True, max_length=64)
    user_id: str = Field(index=True, max_length=64)
    project_id: str = Field(max_length=64)
    title: str = Field(default="", max_length=255)
    updated_at: float = Field(default=0.0)
    created_at: float = Field(default=0.0)
    # MySQL maps bare str → VARCHAR(255); session task_state JSON needs TEXT.
    meta_json: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))


class ChatMessage(SQLModel, table=True):
    __tablename__ = "chat_messages"

    id: str = Field(primary_key=True, max_length=64)
    session_id: str = Field(index=True, max_length=64)
    role: str = Field(max_length=16)
    # Bare str → VARCHAR(255); messages + context thumbs exceed that on MySQL.
    content: str = Field(default="", sa_column=Column(Text, nullable=False))
    thinking: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    meta_json: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: float = Field(default=0.0)
    sort_order: int = Field(default=0)


class DesignSkillGroup(SQLModel, table=True):
    __tablename__ = "design_skill_group"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(max_length=128)
    skill_ids: str = Field(default="[]")
    scenes: str = Field(default="all", max_length=128)
    priority: int = Field(default=0)
    enabled: int = Field(default=1)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)


class DesignExecuteFlow(SQLModel, table=True):
    __tablename__ = "design_execute_flow"

    id: Optional[int] = Field(default=None, primary_key=True)
    scene: str = Field(max_length=32, unique=True)
    skill_ids: str = Field(default="[]")
    force_validate_flags: Optional[str] = Field(default=None)
    step_token_caps: Optional[str] = Field(default=None)
    fail_strategy: str = Field(default="retry_step", max_length=32)
    enabled: int = Field(default=1)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)


class DesignGlobalRule(SQLModel, table=True):
    __tablename__ = "design_global_rule"

    id: Optional[int] = Field(default=None, primary_key=True)
    rule_key: str = Field(max_length=64, unique=True)
    # MySQL maps bare str → VARCHAR(255); stage rules / JSON payloads exceed that.
    rule_value: str = Field(default="", sa_column=Column(Text, nullable=False))
    description: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    enabled: int = Field(default=1)
    updated_at: float = Field(default=0.0)


class DesignCanvasTool(SQLModel, table=True):
    __tablename__ = "design_canvas_tool"

    id: Optional[int] = Field(default=None, primary_key=True)
    op_key: str = Field(max_length=64, unique=True)
    kind: str = Field(default="node", max_length=32)
    label: str = Field(default="", max_length=128)
    model_hint: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    args_schema: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    enabled: int = Field(default=1)
    sort_order: int = Field(default=0)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)


class AgentSessionSnapshot(SQLModel, table=True):
    __tablename__ = "agent_session_snapshot"

    session_id: str = Field(primary_key=True, max_length=64)
    user_id: str = Field(index=True, max_length=64)
    project_id: str = Field(max_length=64)
    # Medium-term task_state JSON grows past VARCHAR(255) within a few turns.
    task_state_json: str = Field(default="", sa_column=Column(Text, nullable=False))
    updated_at: float = Field(default=0.0)
    created_at: float = Field(default=0.0)


class AgentLongMemory(SQLModel, table=True):
    __tablename__ = "agent_long_memory"

    id: str = Field(primary_key=True, max_length=64)
    user_id: str = Field(index=True, max_length=64)
    kind: str = Field(max_length=32)
    text: str = Field(default="")
    status: str = Field(default="active", max_length=16)
    pinned: int = Field(default=0)
    score: float = Field(default=1.0)
    emb: Optional[bytes] = Field(default=None, sa_column=Column(LargeBinary))
    emb_dim: int = Field(default=0)
    emb_model: str = Field(default="", max_length=64)
    embed_status: str = Field(default="pending", max_length=16)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)


class AgentKgTriple(SQLModel, table=True):
    __tablename__ = "agent_kg_triple"

    id: str = Field(primary_key=True, max_length=64)
    user_id: str = Field(index=True, max_length=64)
    subject: str = Field(max_length=128)
    predicate: str = Field(max_length=64)
    object: str = Field(default="")
    weight: float = Field(default=1.0)
    source: str = Field(default="episode", max_length=32)
    status: str = Field(default="active", max_length=16)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)


class AgentEpisode(SQLModel, table=True):
    __tablename__ = "agent_episode"

    id: str = Field(primary_key=True, max_length=64)
    user_id: str = Field(index=True, max_length=64)
    session_id: str = Field(default="", max_length=64)
    project_id: str = Field(default="", max_length=64)
    task_id: str = Field(default="", max_length=64)
    scene: str = Field(default="", max_length=32)
    goal: str = Field(default="")
    summary: str = Field(default="")
    actions_json: Optional[str] = Field(default=None)
    observe_json: Optional[str] = Field(default=None)
    outcome: str = Field(default="success", max_length=16)
    emb: Optional[bytes] = Field(default=None, sa_column=Column(LargeBinary))
    emb_dim: int = Field(default=0)
    emb_model: str = Field(default="", max_length=64)
    embed_status: str = Field(default="pending", max_length=16)
    status: str = Field(default="active", max_length=16)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)


class LlmModel(SQLModel, table=True):
    __tablename__ = "llm_models"

    id: str = Field(primary_key=True, max_length=128)
    label: str = Field(max_length=255)
    # MySQL maps bare Optional[str] → VARCHAR(255); seed blurbs / JSON exceed that.
    description: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    provider: str = Field(default="doubao", max_length=64)
    kind: str = Field(default="text", max_length=16)
    api_model: str = Field(max_length=255)
    icon_key: Optional[str] = Field(default=None, max_length=64)
    icon_url: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    price: Optional[str] = Field(default=None, max_length=255)
    max_attachments: int = Field(default=8)
    thinking: int = Field(default=0)
    enabled: int = Field(default=1)
    sort_order: int = Field(default=100)
    reference_types: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    image_limits: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    price_meta: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    pricing_id: Optional[str] = Field(default=None, max_length=128)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)


class PricingVersion(SQLModel, table=True):
    """Immutable provider price sheet (Billing Protocol PricingVersionSchema)."""

    __tablename__ = "pricing_versions"

    pricing_version_id: str = Field(primary_key=True, max_length=128)
    pricing_id: str = Field(default="", max_length=128, index=True)
    provider: str = Field(default="", max_length=64)
    model_id: str = Field(default="", max_length=128, index=True)
    currency: str = Field(default="USD", max_length=16)
    rates_json: str = Field(default="[]", sa_column=Column(Text, nullable=False))
    status: str = Field(default="draft", max_length=32, index=True)
    effective_from: Optional[float] = Field(default=None)
    effective_to: Optional[float] = Field(default=None)
    source: str = Field(default="", max_length=64)
    notes: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)


class LlmModelRemoved(SQLModel, table=True):
    __tablename__ = "llm_models_removed"

    id: str = Field(primary_key=True, max_length=128)
    removed_at: float = Field(default=0.0)


class ModelUsage(SQLModel, table=True):
    __tablename__ = "model_usage"

    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: float = Field(default=0.0, index=True)
    user_id: Optional[str] = Field(default=None, max_length=64)
    task_id: Optional[str] = Field(default=None, max_length=64)
    source: str = Field(default="unknown", max_length=32)
    provider: Optional[str] = Field(default=None, max_length=64)
    catalog_model_id: Optional[str] = Field(default=None, max_length=128)
    api_model: Optional[str] = Field(default=None, max_length=256)
    status: str = Field(default="ok", max_length=32)
    latency_ms: Optional[int] = Field(default=None)
    prompt_tokens: Optional[int] = Field(default=None)
    completion_tokens: Optional[int] = Field(default=None)
    total_tokens: Optional[int] = Field(default=None)
    cached_tokens: Optional[int] = Field(default=None)
    reasoning_tokens: Optional[int] = Field(default=None)
    image_count: Optional[int] = Field(default=None)
    credits_charged: Optional[int] = Field(default=None)
    cost_cny: Optional[float] = Field(default=None)
    pricing_version_id: Optional[str] = Field(default=None, max_length=128)
    provider_request_id: Optional[str] = Field(default=None, max_length=128)
    usage_json: Optional[str] = Field(default=None)
    meta_json: Optional[str] = Field(default=None)
    error: Optional[str] = Field(default=None)


class DesignOptimizePatch(SQLModel, table=True):
    __tablename__ = "design_optimize_patch"

    id: Optional[int] = Field(default=None, primary_key=True)
    kind: str = Field(max_length=32)
    target_key: str = Field(max_length=128)
    patch_json: str = Field(default="{}")
    rationale: Optional[str] = Field(default=None)
    flags_json: Optional[str] = Field(default=None)
    status: str = Field(default="pending", max_length=32)
    fingerprint: str = Field(max_length=64)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)
    applied_at: Optional[float] = Field(default=None)


class DesignColdBlob(SQLModel, table=True):
    __tablename__ = "design_cold_blob"

    id: Optional[int] = Field(default=None, primary_key=True)
    kind: str = Field(max_length=32, index=True)
    ref_id: str = Field(max_length=64, index=True)
    compress_blob: bytes = Field(sa_column=Column(LargeBinary))
    meta_json: Optional[str] = Field(default=None)
    source_created_at: Optional[float] = Field(default=None)
    created_at: float = Field(default=0.0)


class UserByokProvider(SQLModel, table=True):
    __tablename__ = "user_byok_providers"

    id: str = Field(primary_key=True, max_length=64)
    user_id: str = Field(index=True, max_length=64)
    name: str = Field(max_length=128)
    website: Optional[str] = Field(default=None)
    base_url: str = Field(default="")
    api_model: str = Field(default="", max_length=128)
    model_kind: str = Field(default="text", max_length=16)
    api_key_cipher: str = Field(default="")
    api_key_hint: str = Field(default="", max_length=16)
    created_at: float = Field(default=0.0)
    updated_at: float = Field(default=0.0)
