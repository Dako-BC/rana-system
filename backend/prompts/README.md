# Prompt Files

Edit these ".txt" files to change each agent's system prompt:

- "rana.txt"
- "hara.txt"
- "bombom.txt"
- "luna.txt"
- "hagen.txt"

Edit workflow instructions in:

- "workflows/rana_init.txt"
- "workflows/hara_research.txt"
- "workflows/rana_validate_hara.txt"
- "workflows/bombom_create_ads.txt"
- "workflows/luna_create_video.txt"
- "workflows/rana_final_decision.txt"
- "workflows/hagen_execute.txt"

Edit output schema hints in:

- "schemas/hara.txt"
- "schemas/bombom.txt"
- "schemas/luna.txt"
- "schemas/rana_final.txt"
- "schemas/hagen.txt"

Agent prompt files should not duplicate full JSON examples. Keep output structure in "schemas/" only, then reference the schema from the agent or workflow prompt.

Edit JSON repair instructions in:

- "system/json_repair.txt"
- "system/json_repair_system.txt"

Keep [[LEARNING_CONTEXT]] in "rana.txt" if you still want Rana to receive learning notes from previous feedback.

Keep placeholder names like [[PRODUCT_CONTEXT]], [[HARA_OUTPUT]], and [[RAW_OUTPUT]] exactly as written. The backend replaces those placeholders at runtime.

Default system and UI text should stay in English. User-facing output values should follow the user's input language:

- Mostly Indonesian input: output values in Indonesian.
- Mostly English input: output values in English.
- Mixed input: use the dominant language.
- Balanced Indonesian and English input: default output values to Indonesian.
- Keep JSON keys unchanged; translate values/content only.

Marketing can edit wording, rules, examples, and output values freely. Coordinate with engineering before renaming JSON keys in "schemas/", because UI display and downstream parsing may depend on those field names.

The backend reads these files when an agent runs, so local testing can use updated prompt text without changing Python code.
