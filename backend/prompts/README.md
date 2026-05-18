# Prompt Files

Edit these `.txt` files to change each agent's system prompt:

- `rana.txt`
- `hara.txt`
- `bombom.txt`
- `luna.txt`
- `hagen.txt`

Keep `[[LEARNING_CONTEXT]]` in `rana.txt` if you still want Rana to receive learning notes from previous feedback.

The backend reads these files when an agent runs, so local testing can use updated prompt text without changing Python code.
