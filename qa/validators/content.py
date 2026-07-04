"""Content quality validation."""

import json
import re
from typing import List, Tuple, Dict, Any


class ContentValidator:
    """Validates content quality and coherence."""

    @staticmethod
    def is_meaningful_text(text: str, min_length: int = 8) -> bool:
        """Check if text is meaningful (not gibberish, empty, or placeholder)."""
        text = str(text).strip()

        if len(text) < min_length:
            return False

        # Check for common placeholders
        placeholders = [
            "lorem ipsum",
            "placeholder",
            "[insert",
            "TODO",
            "FIXME",
            "...",
            "xxx",
            "yyy",
            "zzz",
        ]

        text_lower = text.lower()
        for placeholder in placeholders:
            if placeholder in text_lower:
                return False

        # Check if mostly numbers/symbols (likely gibberish)
        alpha_count = sum(1 for c in text if c.isalpha())
        if len(text) > 0 and alpha_count / len(text) < 0.3:
            return False

        return True

    @staticmethod
    def check_text_coherence(text: str) -> Tuple[bool, List[str]]:
        """Check if text is coherent and not obviously broken."""
        errors = []
        text = str(text).strip()

        # Check sentence structure
        sentences = re.split(r'[.!?]+', text)
        sentences = [s.strip() for s in sentences if s.strip()]

        if not sentences:
            errors.append("Text has no complete sentences")
            return False, errors

        # Check for very short average sentence length (might be broken)
        avg_sentence_len = sum(len(s.split())
                               for s in sentences) / len(sentences)
        if avg_sentence_len < 2:
            errors.append(
                f"Sentences too short on average ({avg_sentence_len:.1f} words)")

        return len(errors) == 0, errors

    @staticmethod
    def check_hara_content(data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """Validate Hara content quality."""
        errors = []

        # Check awareness level is recognizable
        valid_levels = {"completely unaware", "not aware", "problem aware",
                        "solution aware", "product aware", "most aware"}
        awareness = str(data.get("awareness_level", "")).strip().lower()

        if awareness not in valid_levels:
            errors.append(f"Unknown awareness level: {awareness}")

        evidence = data.get("awareness_evidence", {})
        if isinstance(evidence, dict):
            evidence_text = " ".join(str(v) for v in evidence.values())
        else:
            evidence_text = str(evidence)
        if not ContentValidator.is_meaningful_text(evidence_text, min_length=20):
            errors.append("awareness_evidence not meaningful")

        strategy = data.get("awareness_strategy", {})
        if isinstance(strategy, dict):
            strategy_text = " ".join(str(v) for v in strategy.values())
        else:
            strategy_text = str(strategy)
        if not ContentValidator.is_meaningful_text(strategy_text, min_length=20):
            errors.append("awareness_strategy not meaningful")

        # Check psychological triggers are meaningful
        triggers = data.get("psychological_triggers", [])
        meaningful_triggers = 0
        for trigger in triggers:
            if isinstance(trigger, dict):
                trigger_text = " ".join(str(v) for v in trigger.values())
            else:
                trigger_text = str(trigger)
            if ContentValidator.is_meaningful_text(trigger_text, min_length=8):
                meaningful_triggers += 1

        if meaningful_triggers == 0:
            errors.append("No meaningful psychological triggers found")

        user_useful_fields = [
            data.get("ad_insight"),
            data.get("target_market", {}).get("demographics") if isinstance(data.get("target_market"), dict) else "",
            data.get("core_problem", {}).get("main_pain_point") if isinstance(data.get("core_problem"), dict) else "",
        ]
        if sum(1 for value in user_useful_fields if ContentValidator.is_meaningful_text(value, 8)) < 2:
            errors.append("Hara output lacks useful user-facing market insight")

        return len(errors) == 0, errors

    @staticmethod
    def check_creative_content(concepts: List[Dict[str, Any]], agent_name: str) -> Tuple[bool, List[str]]:
        """Validate creative agent (Bombom/Luna) content."""
        errors = []

        for i, concept in enumerate(concepts):
            # Check all text fields are meaningful
            for field in concept.keys():
                if field not in ["number", "index", "duration_seconds"]:
                    value = str(concept.get(field, "")).strip()
                    if isinstance(concept.get(field), (dict, list)):
                        value = json.dumps(concept.get(field), ensure_ascii=False)
                    min_length = 4 if field == "psychological_trigger" else 8
                    if not ContentValidator.is_meaningful_text(value, min_length=min_length):
                        errors.append(f"Concept {i} {field} not meaningful")

            # Check for coherence in main text fields
            for field in ["headline", "primary_text", "hook", "content_angle"]:
                if field in concept:
                    text = str(concept[field])
                    is_coherent, coherence_errors = ContentValidator.check_text_coherence(
                        text)
                    if not is_coherent:
                        errors.append(
                            f"Concept {i} {field}: {coherence_errors[0]}")

        return len(errors) == 0, errors

    @staticmethod
    def check_rana_decision_content(data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """Validate Rana final decision usefulness."""
        errors = []

        if not data.get("top_image_ads") and not data.get("top_video_concepts"):
            errors.append("Rana did not select any image ad or video concept")

        rationale = str(data.get("choice_rationale", ""))
        if not ContentValidator.is_meaningful_text(rationale, min_length=30):
            errors.append("Rana choice_rationale is not useful enough")

        summary = str(data.get("user_summary", ""))
        if not ContentValidator.is_meaningful_text(summary, min_length=30):
            errors.append("Rana user_summary is not useful enough")

        next_steps = data.get("next_steps", [])
        if not isinstance(next_steps, list) or not any(ContentValidator.is_meaningful_text(step, 8) for step in next_steps):
            errors.append("Rana next_steps should include actionable guidance")

        return len(errors) == 0, errors

    @staticmethod
    def check_hagen_content(data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """Validate Hagen execution output usefulness."""
        errors = []
        scenes = data.get("script_breakdown", [])

        if not scenes:
            errors.append("Hagen script_breakdown is empty")

        for i, scene in enumerate(scenes):
            if not isinstance(scene, dict):
                continue
            for field in ["visual_direction", "dialog", "on_screen_text", "director_notes"]:
                if not ContentValidator.is_meaningful_text(scene.get(field), 8):
                    errors.append(f"Hagen scene {i} {field} is not meaningful")

        if not any(ContentValidator.is_meaningful_text(item, 8) for item in data.get("production_checklist", []) or []):
            errors.append("Hagen production_checklist is not actionable")

        return len(errors) == 0, errors

    @staticmethod
    def check_relevance_to_context(agent_output: str, product_context: str) -> Tuple[bool, List[str]]:
        """Check if agent output seems relevant to product context."""
        errors = []

        # Extract key terms from context (first 2-3 significant words)
        context_words = set()
        words = product_context.lower().split()
        for word in words:
            # Filter short/common words
            if len(word) > 4 and word not in ["about", "what", "with", "that", "this", "from"]:
                context_words.add(word.strip(".,!?"))
                if len(context_words) >= 10:
                    break

        output_lower = agent_output.lower()

        # Check if at least some context words appear in output
        matching_words = sum(1 for w in context_words if w in output_lower)
        match_ratio = matching_words / \
            len(context_words) if context_words else 0

        if match_ratio < 0.1 and len(context_words) > 3:
            errors.append(
                f"Output seems disconnected from context (only {matching_words}/{len(context_words)} context keywords found)"
            )

        return len(errors) == 0, errors


def validate_content_quality(agent_name: str, output: str, product_context: str = "") -> Tuple[bool, List[str]]:
    """
    Main content quality validation function.

    Args:
        agent_name: Agent name (hara, bombom, luna, rana_decision, hagen)
        output: Raw output from agent
        product_context: Product context for relevance checking

    Returns:
        (is_valid, error_messages)
    """
    validator = ContentValidator()
    errors = []

    # Parse JSON
    try:
        data = json.loads(output)
    except json.JSONDecodeError:
        return False, ["Failed to parse JSON for content validation"]

    # Agent-specific validation
    if agent_name.lower() == "hara":
        is_valid, content_errors = validator.check_hara_content(data)
        errors.extend(content_errors)

    elif agent_name.lower() == "bombom":
        ads = data.get("ad_concepts", [])
        is_valid, content_errors = validator.check_creative_content(
            ads, agent_name)
        errors.extend(content_errors)

    elif agent_name.lower() == "luna":
        videos = data.get("video_concepts", [])
        is_valid, content_errors = validator.check_creative_content(
            videos, agent_name)
        errors.extend(content_errors)

    elif agent_name.lower() in {"rana_decision", "rana_final"}:
        is_valid, content_errors = validator.check_rana_decision_content(data)
        errors.extend(content_errors)

    elif agent_name.lower() == "hagen":
        is_valid, content_errors = validator.check_hagen_content(data)
        errors.extend(content_errors)

    # Check relevance to product context if provided
    if product_context:
        is_relevant, relevance_errors = validator.check_relevance_to_context(
            output, product_context)
        if not is_relevant:
            errors.extend(relevance_errors)

    return len(errors) == 0, errors
