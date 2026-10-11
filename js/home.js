const textInput = document.getElementById("text-input");
const fileInput = document.getElementById("file-input");
const uploadBtn = document.getElementById("upload-btn");
const sampleBtn = document.getElementById("sample-btn");
const startBtn = document.getElementById("start-btn");
const statusEl = document.getElementById("status");

let currentTitle = "Your text";
let sampleIndex = 0;

function setStatus(message) {
  statusEl.textContent = message;
}

// If the learner edits the text by hand, it is "their text" again
textInput.addEventListener("input", () => {
  currentTitle = "Your text";
});

// Upload button opens the file picker
uploadBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;

  setStatus(`Reading "${file.name}"...`);
  uploadBtn.disabled = true;

  try {
    const result = await extractTextFromFile(file, MAX_WORDS);

    if (!result.text.trim()) {
      setStatus(
        "No readable text was found. If this is a scanned PDF (pictures of pages), it cannot be read yet. " +
        "Try a PDF where you can select the text, or paste the text instead."
      );
      return;
    }

    textInput.value = result.text;
    currentTitle = file.name;
    let message = `Loaded "${file.name}".`;
    if (result.trimmed) {
      message += ` For now, BlinkBrief loads the first ${MAX_WORDS} words.`;
    }
    setStatus(message + " Press Start reading when you are ready.");
  } catch (err) {
    console.error(err);
    if (err && err.name === "PasswordException") {
      setStatus("This PDF is password-protected. Please open it, copy the text and paste it above.");
    } else {
      setStatus(err.message || "Sorry, that file could not be read. Try pasting the text instead.");
    }
  } finally {
    uploadBtn.disabled = false;
    fileInput.value = ""; // lets you pick the same file again later
  }
});

// Sample button cycles through the sample passages
sampleBtn.addEventListener("click", () => {
  const sample = PASSAGES[sampleIndex % PASSAGES.length];
  textInput.value = sample.text;
  currentTitle = sample.title;
  sampleIndex++;
  setStatus(`Loaded the sample "${sample.title}". Press Start reading when you are ready.`);
});

// Start reading
startBtn.addEventListener("click", () => {
  const text = textInput.value.trim();
  if (!text) {
    setStatus("Please paste some text, upload a file, or try a sample first.");
    textInput.focus();
    return;
  }

  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const limited = limitWords(paragraphs, MAX_WORDS);

  if (limited.trimmed) {
    textInput.value = limited.text;
    setStatus(
      `That text was longer than ${MAX_WORDS} words, so it has been shortened. ` +
      "Check it, then press Start reading again."
    );
    return;
  }

  setStatus("");
  showReader(currentTitle, text);
});