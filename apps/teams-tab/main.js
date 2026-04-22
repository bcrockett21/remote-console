const input = document.getElementById("command-input");

if (input instanceof HTMLInputElement) {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && input.value.trim().length > 0) {
      window.alert(`Terminal input preview: ${input.value}`);
      input.value = "";
    }
  });
}
