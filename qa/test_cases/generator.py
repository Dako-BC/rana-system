"""Random test case generator for QA fuzzing."""

import json
import random
from typing import Any, Dict, List


class TestCaseGenerator:
    """Generates realistic test cases that match the current prompt schemas."""

    PRODUCTS = [
        "Premium coffee subscription",
        "AI-powered productivity app",
        "Sustainable fashion e-commerce",
        "Mental health meditation platform",
        "Enterprise SaaS analytics tool",
        "Mobile gaming platform",
        "B2B supply chain software",
    ]

    TONES = ["professional", "casual", "urgent", "educational", "premium"]
    AWARENESS_LEVELS = [
        "Completely Unaware",
        "Problem Aware",
        "Solution Aware",
        "Product Aware",
        "Most Aware",
    ]
    TRIGGERS = [
        "social proof",
        "scarcity",
        "authority",
        "urgency",
        "novelty",
        "risk reduction",
        "status gain",
        "loss avoidance",
    ]

    @staticmethod
    def generate_product_context(length: str = "medium", include_specifics: bool = True) -> str:
        product = random.choice(TestCaseGenerator.PRODUCTS)
        tone = random.choice(TestCaseGenerator.TONES)
        context = [
            f"Product name: {product}",
            f"Tone: {tone}",
        ]

        if include_specifics:
            context.extend([
                f"Target audience: buyers aged {random.randint(22, 55)}+ who want practical improvements",
                f"Price point: ${random.randint(10, 500)}",
                f"Key feature: {random.choice(['AI-powered workflow', 'fast onboarding', 'premium support', 'community-driven results'])}",
            ])

        if length in {"medium", "long"}:
            context.append(f"Main challenge: {random.choice(['low awareness', 'crowded category', 'complex value proposition', 'low trust'])}")
        if length == "long":
            context.extend([
                f"Unique selling point: {random.choice(['faster setup', 'better customer service', 'lower total cost', 'more reliable outcomes'])}",
                f"Previous campaign performance: {random.choice(['no prior data', 'moderate engagement', 'good clicks but low conversion'])}",
            ])

        return "\n".join(context)

    @staticmethod
    def generate_hara_output(awareness_level: str | None = None) -> str:
        level = awareness_level or random.choice(TestCaseGenerator.AWARENESS_LEVELS)
        target_index = min(
            len(TestCaseGenerator.AWARENESS_LEVELS) - 1,
            TestCaseGenerator.AWARENESS_LEVELS.index(level) + 1,
        ) if level in TestCaseGenerator.AWARENESS_LEVELS else 2
        target = TestCaseGenerator.AWARENESS_LEVELS[target_index]
        triggers = random.sample(TestCaseGenerator.TRIGGERS, k=3)

        data = {
            "awareness_level": level,
            "awareness_evidence": {
                "source": "product_context",
                "audience_signal": "The audience shows interest in solving the problem but still needs a clearer reason to trust the offer.",
                "why_this_level": f"The brief suggests buyers are currently {level.lower()} and need messaging that moves them toward action.",
            },
            "awareness_target": target,
            "psychological_triggers": [
                {
                    "trigger": trigger,
                    "why_it_matters": f"{trigger.title()} helps the campaign make the offer feel concrete and worth acting on.",
                    "buying_moment": "Use this when the user compares alternatives or hesitates before purchase.",
                }
                for trigger in triggers
            ],
            "awareness_strategy": {
                "current_to_target": f"Move buyers from {level} to {target} with evidence-led creative.",
                "copy_direction": "Lead with the customer pain, then show the practical product outcome.",
                "landing_page_angle": "Show proof, clear benefits, objections, and a simple next step.",
                "follow_up_angle": "Retarget hesitant visitors with comparison proof and customer outcomes.",
            },
            "target_market": {
                "demographics": "Professionals and small business owners aged 25-45 with active online purchasing behavior.",
                "psychographics": "They want faster progress, lower risk, and proof before spending money.",
                "fb_interest_targeting": ["business tools", "productivity", "online shopping"],
            },
            "core_problem": {
                "main_pain_point": "The buyer wants a better result but is unsure which option will actually work.",
                "problem_logic": "Without clear proof, the audience delays purchase and keeps comparing alternatives.",
            },
            "decision_trigger": {
                "trigger": "A clear before-after proof point",
                "explanation": "This creates enough confidence for the buyer to move from research into action.",
            },
            "faq": [
                {"question": "How fast can users see value?", "answer": "Most users should understand the first benefit during onboarding."},
                {"question": "Why choose this over alternatives?", "answer": "The offer combines clarity, support, and measurable outcomes."},
            ],
            "objection": [
                {"objection": "I am not sure this will work for me.", "handling": "Show use cases and low-risk first steps."},
                {"objection": "The price may be too high.", "handling": "Compare the cost with the time or revenue being lost now."},
            ],
            "ad_insight": "The campaign should make the cost of inaction visible before presenting the product as the easier next step.",
            "assumptions_used": ["Audience has enough budget to test the offer", "The product can show at least one proof point"],
            "clarification_questions": ["What proof asset is strongest right now?", "Which audience segment has purchased before?"],
        }
        return json.dumps(data, ensure_ascii=False, indent=2)

    @staticmethod
    def generate_bombom_output(count: int | None = None, awareness_level: str | None = None) -> str:
        count = count or random.randint(3, 5)
        level = awareness_level or random.choice(TestCaseGenerator.AWARENESS_LEVELS)
        ads = []

        for i in range(count):
            ads.append({
                "number": i + 1,
                "awareness_level": level,
                "awareness_strategy": "Make the pain concrete, then show the simplest believable product outcome.",
                "psychological_trigger": random.choice(TestCaseGenerator.TRIGGERS),
                "visual_idea": "Split-screen visual showing the frustrating old workflow beside the calmer improved result.",
                "hook": random.choice([
                    "Still solving this the slow way?",
                    "Your workflow should not feel this heavy.",
                    "The easier path is finally obvious.",
                ]),
                "primary_text": "Turn a repeated daily friction into a simpler system with proof, support, and a clear first step.",
                "headline": random.choice([
                    "Simpler results start here",
                    "Stop losing time to busywork",
                    "Make the smarter switch",
                ]),
            })

        return json.dumps({
            "ad_concepts": ads,
            "production_notes": "Prioritize clean product context, proof elements, and direct contrast between current pain and desired outcome.",
        }, ensure_ascii=False, indent=2)

    @staticmethod
    def generate_luna_output(count: int | None = None, awareness_level: str | None = None) -> str:
        count = count or random.randint(2, 4)
        level = awareness_level or random.choice(TestCaseGenerator.AWARENESS_LEVELS)
        videos = []

        for i in range(count):
            videos.append({
                "number": i + 1,
                "awareness_level": level,
                "awareness_strategy": "Open with a familiar friction, then demonstrate the product as the clean next step.",
                "content_angle": "Problem-to-proof narrative for hesitant buyers.",
                "hook_scene": {
                    "duration": "0-3 seconds",
                    "description": "Show a busy user frustrated by repeated manual work.",
                    "dialogue_or_text": "Still spending hours on this?",
                    "visual": "Close-up of a cluttered task list turning into a simple dashboard.",
                },
                "body_scenes": [
                    {
                        "scene": "Scene 2",
                        "duration": "3-10 seconds",
                        "scene_text": "Introduce the product as the shortcut to a clearer result.",
                        "visual": "Screen recording or product mockup showing the main feature.",
                    },
                    {
                        "scene": "Scene 3",
                        "duration": "10-18 seconds",
                        "scene_text": "Show proof, customer outcome, or a measurable before-after result.",
                        "visual": "Overlay metric cards and testimonial-style proof.",
                    },
                ],
                "production_requirements": {
                    "talent": "One presenter or user persona",
                    "location": "Desk, office, or clean product demo environment",
                    "props": "Laptop, phone, simple dashboard mockup",
                    "estimated_total_duration": "20 seconds",
                },
            })

        return json.dumps({"video_concepts": videos}, ensure_ascii=False, indent=2)

    @staticmethod
    def generate_rana_decision(bombom_output: str | None = None, luna_output: str | None = None, run_hagen: bool | None = None) -> str:
        if run_hagen is None:
            run_hagen = random.choice([True, False])

        bombom_numbers: List[int] = []
        luna_numbers: List[int] = []

        if bombom_output:
            try:
                bombom_numbers = [item["number"] for item in json.loads(bombom_output).get("ad_concepts", []) if isinstance(item.get("number"), int)]
            except (json.JSONDecodeError, AttributeError):
                pass
        if luna_output:
            try:
                luna_numbers = [item["number"] for item in json.loads(luna_output).get("video_concepts", []) if isinstance(item.get("number"), int)]
            except (json.JSONDecodeError, AttributeError):
                pass

        data = {
            "top_image_ads": bombom_numbers[:3],
            "top_video_concepts": luna_numbers[:2],
            "choice_rationale": "Selected concepts that best connect the awareness diagnosis to a clear user pain, proof point, and practical next step.",
            "awareness_check": "The selected ideas match the audience awareness stage and avoid jumping too quickly into hard selling.",
            "needs_human_review": ["Confirm available proof assets before final production", "Check platform-specific ad policy wording"],
            "next_steps": ["Prepare the strongest proof asset", "Produce the top selected image ad", "Turn the top video concept into a short script"],
            "run_hagen": run_hagen,
            "user_summary": "Use the selected concepts to show the cost of the current problem, then make the product feel like the obvious lower-risk move.",
        }
        return json.dumps(data, ensure_ascii=False, indent=2)

    @staticmethod
    def generate_hagen_output() -> str:
        data = {
            "script_breakdown": [
                {
                    "scene_number": 1,
                    "duration": "0-3 seconds",
                    "visual_direction": "Open on the user facing the repeated frustrating task.",
                    "dialog": "Still doing this manually every day?",
                    "on_screen_text": "The old way costs more than you think",
                    "audio": "Short tension beat",
                    "director_notes": "Keep the shot tight so the frustration is obvious.",
                    "reusable": True,
                },
                {
                    "scene_number": 2,
                    "duration": "3-12 seconds",
                    "visual_direction": "Show the product simplifying the workflow step by step.",
                    "dialog": "Here is the cleaner way to get the result.",
                    "on_screen_text": "One workflow. Clear next step.",
                    "audio": "Music shifts to optimistic and focused",
                    "director_notes": "Use screen overlays to make the benefit visible.",
                    "reusable": True,
                },
            ],
            "heygen_notes": "Use a confident presenter voice, simple framing, and captions that match the on-screen text.",
            "production_checklist": ["Confirm final hook", "Record product walkthrough", "Export vertical and square versions"],
        }
        return json.dumps(data, ensure_ascii=False, indent=2)

    @staticmethod
    def generate_full_pipeline_test() -> Dict[str, Any]:
        product_context = TestCaseGenerator.generate_product_context(length=random.choice(["short", "medium", "long"]))
        hara = TestCaseGenerator.generate_hara_output()
        level = json.loads(hara)["awareness_level"]
        bombom = TestCaseGenerator.generate_bombom_output(awareness_level=level)
        luna = TestCaseGenerator.generate_luna_output(awareness_level=level)
        rana = TestCaseGenerator.generate_rana_decision(bombom, luna)
        hagen = TestCaseGenerator.generate_hagen_output() if json.loads(rana).get("run_hagen") else None

        return {
            "product_context": product_context,
            "hara": hara,
            "bombom": bombom,
            "luna": luna,
            "rana_decision": rana,
            "hagen": hagen,
        }


def generate_edge_case_tests() -> List[Dict[str, Any]]:
    """Generate edge case test scenarios."""
    return [
        {
            "name": "minimal_input",
            "product_context": "Product name: Simple product\nTarget audience: local buyers\nPain point: slow manual work",
            "description": "Very short but meaningful product context",
        },
        {
            "name": "completely_unaware_audience",
            "hara": TestCaseGenerator.generate_hara_output("Completely Unaware"),
            "description": "Audience completely unaware of product category",
        },
        {
            "name": "most_aware_audience",
            "hara": TestCaseGenerator.generate_hara_output("Most Aware"),
            "description": "Audience already highly aware and ready to buy",
        },
    ]
