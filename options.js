const toggle = document.getElementById("deleteOriginalsToggle");
const savedNote = document.getElementById("savedNote");

async function load() {
  toggle.checked = await getDeleteOriginalsEnabled();
}

toggle.addEventListener("change", async () => {
  await setDeleteOriginalsEnabled(toggle.checked);
  savedNote.textContent = "Saved.";
  setTimeout(() => {
    savedNote.textContent = "";
  }, 1500);
});

load();
