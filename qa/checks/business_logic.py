"""Business logic validation checks."""

import json
from typing import Dict, List, Tuple, Any


class BusinessLogicChecker:
    """Validates business logic and workflow constraints."""

    AWARENESS_LEVELS = {
        "completely unaware",
        "not aware",
        "problem aware",
        "solution aware",
        "product aware",
        "most aware",
    }

    @staticmethod
    def check_hara_is_prerequisite(hara_output: str) -> Tuple[bool, List[str]]:
        """
        Check if Hara output has clear awareness diagnosis.
        Creative agents (Bombom/Luna) should only run if this passes.
        """
        errors = []

        try:
            data = json.loads(hara_output)
        except json.JSONDecodeError:
            return False, ["Cannot parse Hara output for validation"]

        # Check required fields
        required = ["awareness_level", "awareness_evidence",
                    "awareness_strategy", "psychological_triggers"]
        for field in required:
            if not data.get(field):
                errors.append(
                    f"Hara missing required field for creative work: {field}")

        # Check awareness level is valid
        awareness = str(data.get("awareness_level", "")).strip().lower()
        if awareness not in BusinessLogicChecker.AWARENESS_LEVELS:
            errors.append(f"Hara awareness_level invalid: {awareness}")

        # Check triggers exist
        triggers = data.get("psychological_triggers", [])
        if not isinstance(triggers, list) or len(triggers) == 0:
            errors.append("Hara has no psychological triggers defined")

        return len(errors) == 0, errors

    @staticmethod
    def check_creative_agents_consistency(
        bombom_output: str,
        luna_output: str,
        hara_output: str
    ) -> Tuple[bool, List[str]]:
        """
        Check if Bombom and Luna outputs are consistent with Hara's findings.
        Both should reference the same awareness level/strategy.
        """
        errors = []

        try:
            hara_data = json.loads(hara_output)
            bombom_data = json.loads(bombom_output)
            luna_data = json.loads(luna_output)
        except json.JSONDecodeError as e:
            return False, [f"Failed to parse outputs for consistency check: {str(e)}"]

        # Check that creative agents produced concepts
        bombom_ads = bombom_data.get("ad_concepts", [])
        luna_videos = luna_data.get("video_concepts", [])

        if not bombom_ads:
            errors.append("Bombom produced no image ad concepts")

        if not luna_videos:
            errors.append("Luna produced no video concepts")

        # Check that outputs reference appropriate awareness level
        hara_awareness = str(hara_data.get(
            "awareness_level", "")).strip().lower()
        bombom_text = json.dumps(bombom_data).lower()
        luna_text = json.dumps(luna_data).lower()

        # At least one creative should mention awareness or strategy
        if hara_awareness not in bombom_text and hara_awareness not in luna_text:
            errors.append(
                f"Creative outputs don't reference Hara's awareness level ({hara_awareness})"
            )

        return len(errors) == 0, errors

    @staticmethod
    def check_rana_decision_references_creatives(
        rana_decision: str,
        bombom_output: str,
        luna_output: str
    ) -> Tuple[bool, List[str]]:
        """
        Check if Rana decision references outputs from Bombom and Luna.
        The decision should have made a choice based on creative work.
        """
        errors = []

        try:
            rana_data = json.loads(rana_decision)
            bombom_data = json.loads(bombom_output)
            luna_data = json.loads(luna_output)
        except json.JSONDecodeError:
            return False, ["Failed to parse outputs for Rana decision check"]

        # Check that Rana selected from available concepts
        selected_ads = rana_data.get("top_image_ads", [])
        selected_videos = rana_data.get("top_video_concepts", [])
        available_ads = bombom_data.get("ad_concepts", [])
        available_videos = luna_data.get("video_concepts", [])
        available_ad_numbers = {
            item.get("number") for item in available_ads if isinstance(item, dict)
        }
        available_video_numbers = {
            item.get("number") for item in available_videos if isinstance(item, dict)
        }

        # Should have selected at least one of each if both were available
        if available_ads and not selected_ads:
            errors.append(
                "Rana didn't select any image ads despite Bombom providing them")

        if available_videos and not selected_videos:
            errors.append(
                "Rana didn't select any video concepts despite Luna providing them")

        invalid_ads = [number for number in selected_ads if number not in available_ad_numbers]
        if invalid_ads:
            errors.append(
                f"Rana selected image ad number(s) not provided by Bombom: {invalid_ads}")

        invalid_videos = [
            number for number in selected_videos if number not in available_video_numbers]
        if invalid_videos:
            errors.append(
                f"Rana selected video concept number(s) not provided by Luna: {invalid_videos}")

        # Check rationale exists
        rationale = str(rana_data.get("choice_rationale", "")).strip()
        if len(rationale) < 20:
            errors.append("Rana decision rationale too brief")

        return len(errors) == 0, errors

    @staticmethod
    def check_hagen_is_optional(
        rana_decision: str,
        hagen_output: str = None
    ) -> Tuple[bool, List[str]]:
        """
        Check if Hagen execution is consistent with Rana decision.
        - If run_hagen=true, Hagen output must exist
        - If run_hagen=false, Hagen output should be empty/None
        """
        errors = []

        try:
            rana_data = json.loads(rana_decision)
        except json.JSONDecodeError:
            return False, ["Failed to parse Rana decision"]

        run_hagen = rana_data.get("run_hagen", False)

        if run_hagen and not hagen_output:
            errors.append(
                "Rana set run_hagen=true but no Hagen output generated")

        if not run_hagen and hagen_output:
            try:
                hagen_data = json.loads(hagen_output)
                if hagen_data.get("script_breakdown"):
                    errors.append(
                        "Rana set run_hagen=false but Hagen still generated output")
            except json.JSONDecodeError:
                pass

        return len(errors) == 0, errors

    @staticmethod
    def check_no_circular_logic(
        agent_outputs: Dict[str, str]
    ) -> Tuple[bool, List[str]]:
        """
        Check for circular logic or infinite loops in agent chain.
        E.g., outputs referencing themselves inappropriately.
        """
        errors = []

        # Check that each agent's output is distinct
        texts = {}
        for agent, output in agent_outputs.items():
            if output:
                texts[agent] = output.lower()[:500]  # First 500 chars

        # Check for suspicious repetition
        for agent1, text1 in texts.items():
            for agent2, text2 in texts.items():
                if agent1 < agent2:
                    similarity = sum(1 for a, b in zip(
                        text1, text2) if a == b) / max(len(text1), len(text2))
                    if similarity > 0.8:
                        errors.append(
                            f"High similarity between {agent1} and {agent2} outputs "
                            f"({similarity:.0%}) - possible circular logic"
                        )

        return len(errors) == 0, errors

    @staticmethod
    def check_full_workflow_validity(
        hara_output: str,
        bombom_output: str = None,
        luna_output: str = None,
        rana_decision: str = None,
        hagen_output: str = None,
        skip_creative: bool = False
    ) -> Tuple[bool, List[str]]:
        """
        Comprehensive workflow validation.

        Args:
            hara_output: Hara market research output
            bombom_output: Bombom image ads (required if skip_creative=False)
            luna_output: Luna video concepts (required if skip_creative=False)
            rana_decision: Rana final decision
            hagen_output: Hagen execution script (optional)
            skip_creative: If True, creative agents were skipped (awareness check failed)

        Returns:
            (is_valid, error_messages)
        """
        errors = []

        # Stage 1: Validate Hara
        hara_valid, hara_errors = BusinessLogicChecker.check_hara_is_prerequisite(
            hara_output)
        if not hara_valid:
            errors.extend(hara_errors)
            if skip_creative:
                # If creative was skipped intentionally, that's OK
                pass
            else:
                errors.append(
                    "Hara validation failed but creative work was still attempted")

        # Stage 2: If creative work was done, validate consistency
        if not skip_creative and bombom_output and luna_output:
            consistency_valid, consistency_errors = BusinessLogicChecker.check_creative_agents_consistency(
                bombom_output, luna_output, hara_output
            )
            if not consistency_valid:
                errors.extend(consistency_errors)

        # Stage 3: Validate Rana decision references creatives
        if rana_decision and bombom_output and luna_output:
            decision_valid, decision_errors = BusinessLogicChecker.check_rana_decision_references_creatives(
                rana_decision, bombom_output, luna_output
            )
            if not decision_valid:
                errors.extend(decision_errors)

        # Stage 4: Validate Hagen consistency with Rana
        if rana_decision:
            hagen_valid, hagen_errors = BusinessLogicChecker.check_hagen_is_optional(
                rana_decision, hagen_output
            )
            if not hagen_valid:
                errors.extend(hagen_errors)

        # Stage 5: Check for circular logic
        all_outputs = {
            "hara": hara_output,
            "bombom": bombom_output,
            "luna": luna_output,
            "rana": rana_decision,
            "hagen": hagen_output,
        }
        outputs_to_check = {k: v for k, v in all_outputs.items() if v}
        if len(outputs_to_check) > 1:
            circular_valid, circular_errors = BusinessLogicChecker.check_no_circular_logic(
                outputs_to_check)
            if not circular_valid:
                errors.extend(circular_errors)

        return len(errors) == 0, errors
