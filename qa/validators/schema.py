"""Schema validation for agent outputs."""

import json
from typing import Any, Dict, List, Tuple


class SchemaValidator:
    """Validates JSON schema compliance for agent outputs."""

    AWARENESS_LEVELS = {
        "completely unaware",
        "not aware",
        "problem aware",
        "solution aware",
        "product aware",
        "most aware",
    }

    @staticmethod
    def validate_json(data: str, agent_name: str) -> Tuple[bool, List[str]]:
        """Validate if string is valid JSON."""
        try:
            json.loads(data)
            return True, []
        except json.JSONDecodeError as exc:
            return False, [f"[{agent_name}] Invalid JSON: {exc}"]

    @staticmethod
    def _has_text(data: Dict[str, Any], field: str, agent: str, min_len: int = 3) -> List[str]:
        value = data.get(field)
        if not isinstance(value, str) or len(value.strip()) < min_len:
            return [f"[{agent}] {field} must be meaningful text"]
        return []

    @staticmethod
    def _has_object(data: Dict[str, Any], field: str, agent: str) -> List[str]:
        if not isinstance(data.get(field), dict):
            return [f"[{agent}] {field} must be an object"]
        return []

    @staticmethod
    def _has_list(data: Dict[str, Any], field: str, agent: str, min_len: int = 1) -> List[str]:
        value = data.get(field)
        if not isinstance(value, list):
            return [f"[{agent}] {field} must be a list"]
        if len(value) < min_len:
            return [f"[{agent}] {field} must contain at least {min_len} item(s)"]
        return []

    @classmethod
    def _validate_awareness(cls, value: Any, agent: str, path: str) -> List[str]:
        normalized = str(value or "").strip().lower()
        if normalized not in cls.AWARENESS_LEVELS:
            return [
                f"[{agent}] {path} invalid: {value!r}. "
                f"Expected one of: {', '.join(sorted(cls.AWARENESS_LEVELS))}"
            ]
        return []

    @classmethod
    def validate_hara_schema(cls, data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """Validate Hara market research output schema."""
        errors: List[str] = []
        agent = "HARA"

        errors.extend(cls._has_text(data, "awareness_level", agent))
        errors.extend(cls._validate_awareness(data.get("awareness_level"), agent, "awareness_level"))
        errors.extend(cls._has_object(data, "awareness_evidence", agent))
        errors.extend(cls._has_text(data, "awareness_target", agent))
        errors.extend(cls._validate_awareness(data.get("awareness_target"), agent, "awareness_target"))
        errors.extend(cls._has_list(data, "psychological_triggers", agent))
        errors.extend(cls._has_object(data, "awareness_strategy", agent))
        errors.extend(cls._has_object(data, "target_market", agent))
        errors.extend(cls._has_object(data, "core_problem", agent))
        errors.extend(cls._has_object(data, "decision_trigger", agent))
        errors.extend(cls._has_list(data, "faq", agent))
        errors.extend(cls._has_list(data, "objection", agent))
        errors.extend(cls._has_text(data, "ad_insight", agent, min_len=8))

        evidence = data.get("awareness_evidence", {})
        if isinstance(evidence, dict):
            for field in ["source", "audience_signal", "why_this_level"]:
                errors.extend(cls._has_text(evidence, field, agent, min_len=4))

        strategy = data.get("awareness_strategy", {})
        if isinstance(strategy, dict):
            for field in ["current_to_target", "copy_direction", "landing_page_angle", "follow_up_angle"]:
                errors.extend(cls._has_text(strategy, field, agent, min_len=4))

        target_market = data.get("target_market", {})
        if isinstance(target_market, dict):
            errors.extend(cls._has_text(target_market, "demographics", agent, min_len=4))
            errors.extend(cls._has_text(target_market, "psychographics", agent, min_len=4))
            errors.extend(cls._has_list(target_market, "fb_interest_targeting", agent))

        core_problem = data.get("core_problem", {})
        if isinstance(core_problem, dict):
            errors.extend(cls._has_text(core_problem, "main_pain_point", agent, min_len=4))
            errors.extend(cls._has_text(core_problem, "problem_logic", agent, min_len=4))

        decision_trigger = data.get("decision_trigger", {})
        if isinstance(decision_trigger, dict):
            errors.extend(cls._has_text(decision_trigger, "trigger", agent, min_len=4))
            errors.extend(cls._has_text(decision_trigger, "explanation", agent, min_len=4))

        for i, trigger in enumerate(data.get("psychological_triggers", []) or []):
            if not isinstance(trigger, dict):
                errors.append(f"[{agent}] psychological_triggers[{i}] must be an object")
                continue
            for field in ["trigger", "why_it_matters", "buying_moment"]:
                errors.extend(cls._has_text(trigger, field, agent, min_len=4))

        for i, item in enumerate(data.get("faq", []) or []):
            if not isinstance(item, dict):
                errors.append(f"[{agent}] faq[{i}] must be an object")
                continue
            errors.extend(cls._has_text(item, "question", agent, min_len=4))
            errors.extend(cls._has_text(item, "answer", agent, min_len=4))

        for i, item in enumerate(data.get("objection", []) or []):
            if not isinstance(item, dict):
                errors.append(f"[{agent}] objection[{i}] must be an object")
                continue
            errors.extend(cls._has_text(item, "objection", agent, min_len=4))
            errors.extend(cls._has_text(item, "handling", agent, min_len=4))

        return len(errors) == 0, errors

    @classmethod
    def validate_bombom_schema(cls, data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """Validate Bombom image ad concepts schema."""
        errors: List[str] = []
        agent = "BOMBOM"

        errors.extend(cls._has_list(data, "ad_concepts", agent))
        for i, ad in enumerate(data.get("ad_concepts", []) or []):
            if not isinstance(ad, dict):
                errors.append(f"[{agent}] ad_concepts[{i}] must be an object")
                continue
            if not isinstance(ad.get("number"), int):
                errors.append(f"[{agent}] ad_concepts[{i}].number must be an integer")
            errors.extend(cls._validate_awareness(ad.get("awareness_level"), agent, f"ad_concepts[{i}].awareness_level"))
            for field in ["awareness_strategy", "visual_idea", "hook", "primary_text", "headline"]:
                errors.extend(cls._has_text(ad, field, agent, min_len=8))
            errors.extend(cls._has_text(ad, "psychological_trigger", agent, min_len=4))

        errors.extend(cls._has_text(data, "production_notes", agent, min_len=8))
        return len(errors) == 0, errors

    @classmethod
    def validate_luna_schema(cls, data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """Validate Luna video ad concepts schema."""
        errors: List[str] = []
        agent = "LUNA"

        errors.extend(cls._has_list(data, "video_concepts", agent))
        for i, video in enumerate(data.get("video_concepts", []) or []):
            if not isinstance(video, dict):
                errors.append(f"[{agent}] video_concepts[{i}] must be an object")
                continue
            if not isinstance(video.get("number"), int):
                errors.append(f"[{agent}] video_concepts[{i}].number must be an integer")
            errors.extend(cls._validate_awareness(video.get("awareness_level"), agent, f"video_concepts[{i}].awareness_level"))
            errors.extend(cls._has_text(video, "awareness_strategy", agent, min_len=8))
            errors.extend(cls._has_text(video, "content_angle", agent, min_len=8))
            errors.extend(cls._has_object(video, "hook_scene", agent))
            errors.extend(cls._has_list(video, "body_scenes", agent))
            errors.extend(cls._has_object(video, "production_requirements", agent))

            hook = video.get("hook_scene", {})
            if isinstance(hook, dict):
                for field in ["duration", "description", "dialogue_or_text", "visual"]:
                    errors.extend(cls._has_text(hook, field, agent, min_len=3))

            for scene_index, scene in enumerate(video.get("body_scenes", []) or []):
                if not isinstance(scene, dict):
                    errors.append(f"[{agent}] video_concepts[{i}].body_scenes[{scene_index}] must be an object")
                    continue
                for field in ["scene", "duration", "scene_text", "visual"]:
                    errors.extend(cls._has_text(scene, field, agent, min_len=3))

            requirements = video.get("production_requirements", {})
            if isinstance(requirements, dict):
                for field in ["talent", "location", "props", "estimated_total_duration"]:
                    errors.extend(cls._has_text(requirements, field, agent, min_len=3))

        return len(errors) == 0, errors

    @staticmethod
    def validate_rana_decision_schema(data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """Validate Rana final decision schema."""
        errors: List[str] = []
        agent = "RANA_DECISION"

        for field in ["top_image_ads", "top_video_concepts", "needs_human_review", "next_steps"]:
            value = data.get(field)
            if not isinstance(value, list):
                errors.append(f"[{agent}] {field} must be a list")

        for field in ["choice_rationale", "awareness_check", "user_summary"]:
            value = data.get(field)
            if not isinstance(value, str) or len(value.strip()) < 8:
                errors.append(f"[{agent}] {field} must be meaningful text")

        if not isinstance(data.get("run_hagen"), bool):
            errors.append(f"[{agent}] run_hagen must be boolean")

        for field in ["top_image_ads", "top_video_concepts"]:
            for i, item in enumerate(data.get(field, []) or []):
                if not isinstance(item, int):
                    errors.append(f"[{agent}] {field}[{i}] must be an integer concept number")

        return len(errors) == 0, errors

    @staticmethod
    def validate_hagen_schema(data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """Validate Hagen execution script schema."""
        errors: List[str] = []
        agent = "HAGEN"

        scenes = data.get("script_breakdown")
        if not isinstance(scenes, list) or not scenes:
            errors.append(f"[{agent}] script_breakdown must be a non-empty list")
        else:
            for i, scene in enumerate(scenes):
                if not isinstance(scene, dict):
                    errors.append(f"[{agent}] script_breakdown[{i}] must be an object")
                    continue
                if not isinstance(scene.get("scene_number"), int):
                    errors.append(f"[{agent}] script_breakdown[{i}].scene_number must be an integer")
                for field in ["duration", "visual_direction", "dialog", "on_screen_text", "audio", "director_notes"]:
                    value = scene.get(field)
                    if not isinstance(value, str) or len(value.strip()) < 3:
                        errors.append(f"[{agent}] script_breakdown[{i}].{field} must be meaningful text")
                if not isinstance(scene.get("reusable"), bool):
                    errors.append(f"[{agent}] script_breakdown[{i}].reusable must be boolean")

        if not isinstance(data.get("heygen_notes"), str) or len(str(data.get("heygen_notes", "")).strip()) < 8:
            errors.append(f"[{agent}] heygen_notes must be meaningful text")
        if not isinstance(data.get("production_checklist"), list) or not data.get("production_checklist"):
            errors.append(f"[{agent}] production_checklist must be a non-empty list")

        return len(errors) == 0, errors


def validate_agent_output(agent_name: str, output: str) -> Tuple[bool, List[str]]:
    """
    Validate an agent output.

    Args:
        agent_name: One of "hara", "bombom", "luna", "rana_decision", "hagen"
        output: Raw JSON string from agent
    """
    validator = SchemaValidator()

    is_valid_json, json_errors = validator.validate_json(output, agent_name)
    if not is_valid_json:
        return False, json_errors

    data = json.loads(output)
    if not isinstance(data, dict):
        return False, [f"[{agent_name}] Output root must be a JSON object"]

    schema_validator = {
        "hara": validator.validate_hara_schema,
        "bombom": validator.validate_bombom_schema,
        "luna": validator.validate_luna_schema,
        "rana_decision": validator.validate_rana_decision_schema,
        "rana_final": validator.validate_rana_decision_schema,
        "hagen": validator.validate_hagen_schema,
    }.get(agent_name.lower())

    if not schema_validator:
        return False, [f"[QA] Unknown agent: {agent_name}"]

    return schema_validator(data)
