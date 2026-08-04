"""Provider-neutral structured-summary generation primitives.

These modules intentionally have no database dependency.  Generation services pass
them a previously persisted Ready Context Package and retain only validated output.
"""

from .client import ProviderRequestError, generate_structured_summary, generate_validated_summary
from .models import ProviderProfile, StructuredSummaryRequest, StructuredSummaryResult
from .prompt import PROMPT_VERSION, build_summary_messages
from .structured import SUMMARY_SCHEMA_VERSION, SummaryDraft, parse_and_validate_summary

__all__ = [
    "PROMPT_VERSION", "SUMMARY_SCHEMA_VERSION", "ProviderProfile",
    "ProviderRequestError", "StructuredSummaryRequest", "StructuredSummaryResult",
    "SummaryDraft", "build_summary_messages", "generate_structured_summary", "generate_validated_summary",
    "parse_and_validate_summary",
]
