"""verified phone number per user

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-05
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_ACTIONS = (
    "credential_added",
    "credential_updated",
    "credential_used",
    "credential_revoked",
    "session_saved",
    "session_used",
    "session_revoked",
    "secret_pasted_in_chat",
)
NEW_ACTIONS = (*OLD_ACTIONS, "phone_verified", "phone_used", "phone_removed")


def _check(actions: tuple[str, ...]) -> str:
    return "action IN (" + ", ".join(f"'{a}'" for a in actions) + ")"


def upgrade() -> None:
    op.create_table(
        "user_phones",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("nonce", sa.LargeBinary(), nullable=False),
        sa.Column("encrypted_dek", sa.LargeBinary(), nullable=False),
        sa.Column("dek_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("key_version", sa.SmallInteger(), server_default=sa.text("1"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.drop_constraint("ck_audit_log_action", "audit_log", type_="check")
    op.create_check_constraint("ck_audit_log_action", "audit_log", _check(NEW_ACTIONS))


def downgrade() -> None:
    op.execute(
        "DELETE FROM audit_log WHERE action IN ('phone_verified', 'phone_used', 'phone_removed')"
    )
    op.drop_constraint("ck_audit_log_action", "audit_log", type_="check")
    op.create_check_constraint("ck_audit_log_action", "audit_log", _check(OLD_ACTIONS))
    op.drop_table("user_phones")
