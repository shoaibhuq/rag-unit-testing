1. Create virtual env and install dependencies

```bash
python3 -m venv venv
pip install -r requirements.txt
```

2. Source venv (this may be different if you're on Windows or MacOS)
```bash
source ./venv/bin/activate
```

3. Copy `.env.example` and rename the new file to `.env`. Add respective env variables.

3. Run
```bash
python main.py
```