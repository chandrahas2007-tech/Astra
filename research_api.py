
import os
import uuid
from pathlib import Path

import fitz
from docx import Document
from flask import Flask, request, jsonify
from openai import OpenAI
from dotenv import load_dotenv
from werkzeug.utils import secure_filename

load_dotenv()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 15 * 1024 * 1024

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}
documents = {}

def extract_text(path):
    extension = Path(path).suffix.lower()

    if extension == ".pdf":
        pdf = fitz.open(path)
        return "\n".join(page.get_text() for page in pdf)

    if extension == ".docx":
        doc = Document(path)
        return "\n".join(p.text for p in doc.paragraphs)

    if extension == ".txt":
        return Path(path).read_text(encoding="utf-8")

    raise ValueError("Unsupported document format")


def generate_ai_response(prompt):
    response = client.responses.create(
        model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        instructions=(
            "You are ASTRA Research Assistant. "
            "Analyze documents accurately. Never invent research findings. "
            "Clearly state when information is missing or uncertain. "
            "Use headings, bullet points and simple explanations."
        ),
        input=prompt
    )
    return response.output_text


@app.route("/api/research/upload", methods=["POST"])
def upload_document():
    if "file" not in request.files:
        return jsonify({"error": "No document uploaded"}), 400

    file = request.files["file"]
    extension = Path(file.filename or "").suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        return jsonify({"error": "Only PDF, DOCX and TXT files are allowed"}), 400

    os.makedirs("uploads", exist_ok=True)

    document_id = str(uuid.uuid4())
    filename = secure_filename(file.filename or "document")

    path = os.path.join(
        "uploads",
        document_id + "_" + filename
    )

    file.save(path)

    try:
        text = extract_text(path)

        if not text.strip():
            raise ValueError(
                "No readable text found. Scanned PDFs need OCR."
            )

        if len(text) > 120000:
            text = text[:120000]

        documents[document_id] = text

        return jsonify({
            "success": True,
            "document_id": document_id,
            "filename": filename,
            "message": "Document uploaded successfully"
        })

    except Exception as error:
        if os.path.exists(path):
            os.remove(path)
        return jsonify({"error": str(error)}), 400


@app.route("/api/research/notes", methods=["POST"])
def generate_notes():
    data = request.get_json(silent=True) or {}

    document_id = data.get("document_id")
    mode = data.get("mode", "both")

    text = documents.get(document_id)

    if not text:
        return jsonify({"error": "Document not found. Upload it again."}), 404

    if mode not in {"simple", "detailed", "both"}:
        return jsonify({"error": "Invalid notes mode"}), 400

    prompt = f"""
    Analyze this research document and generate {mode} notes.

    Include the following sections:

    1. Research title and topic
    2. Abstract and overview
    3. Research objectives
    4. Problem statement
    5. Methodology
    6. Important concepts and terminology
    7. Key findings
    8. Important equations and their explanations
    9. Tables and important observations
    10. Limitations
    11. Research gaps
    12. Future scope
    13. Final conclusion

    Give page references where available.
    Do not invent page numbers, equations or findings.
    Explain complex technical concepts in accessible language.

    DOCUMENT:
    {text}
    """

    try:
        notes = generate_ai_response(prompt)
        return jsonify({"success": True, "notes": notes})

    except Exception:
        return jsonify({"error": "AI analysis failed. Check your API configuration."}), 500


@app.route("/api/research/ask", methods=["POST"])
def ask_question():
    data = request.get_json(silent=True) or {}

    document_id = data.get("document_id")
    question = data.get("question", "").strip()

    text = documents.get(document_id)

    if not text:
        return jsonify({"error": "Document not found"}), 404

    if not question or len(question) > 2000:
        return jsonify({"error": "Enter a valid question"}), 400

    prompt = f"""
    Answer the question using ONLY the provided research document.

    If the answer is not present, say so clearly.
    Explain technical concepts simply and cite page numbers only
    when they can be verified.

    DOCUMENT:
    {text}

    QUESTION:
    {question}
    """

    try:
        answer = generate_ai_response(prompt)
        return jsonify({"success": True, "answer": answer})

    except Exception:
        return jsonify({"error": "Could not generate an answer"}), 500


@app.errorhandler(413)
def file_too_large(error):
    return jsonify({"error": "Maximum upload size is 15 MB"}), 413


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8001, debug=False)
