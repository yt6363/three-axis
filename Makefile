PYTHON ?= python3

.PHONY: backend frontend install-backend install-frontend

install-backend:
	cd backend && $(PYTHON) -m pip install -r requirements.txt

install-frontend:
	cd vedic-ui && npm install

backend:
	cd backend && $(PYTHON) -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

frontend:
	cd vedic-ui && npm run dev

