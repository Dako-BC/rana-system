# Prompt Files

Edit these `.txt` files to change each agent's system prompt:

- `rana.txt`
- `hara.txt`
- `bombom.txt`
- `luna.txt`
- `hagen.txt`

Keep `[[LEARNING_CONTEXT]]` in `rana.txt` if you still want Rana to receive learning notes from previous feedback.

Default system and UI text should stay in English. User-facing output values should follow the user's input language:

- Mostly Indonesian input: output values in Indonesian.
- Mostly English input: output values in English.
- Mixed input: use the dominant language.
- Balanced Indonesian and English input: default output values to Indonesian.
- Keep JSON keys unchanged; translate values/content only.

The backend reads these files when an agent runs, so local testing can use updated prompt text without changing Python code.
