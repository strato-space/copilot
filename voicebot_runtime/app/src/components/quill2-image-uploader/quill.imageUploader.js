import LoadingImage from "./blots/image.js";
import FileBlot from "./blots/file.js"
import "./quill.imageUploader.css";
import e from "cors";

class ImageUploader {
  constructor(quill, options) {
    this.quill = quill;
    this.options = options;
    this.range = null;

    if (typeof this.options.upload !== "function") {
      console.warn(
        "[Missing config] upload function that returns a promise is required"
      );
    }

    if (this.options.loadingClass) {
      LoadingImage.className = this.options.loadingClass
    }

    const toolbar = this.quill.getModule("toolbar");
    toolbar.addHandler("image", this.selectLocalImage.bind(this));

    this.handleDrop = this.handleDrop.bind(this);
    this.handlePaste = this.handlePaste.bind(this);

    this.quill.root.addEventListener("drop", this.handleDrop, false);
    this.quill.root.addEventListener("paste", this.handlePaste, false);
  }

  selectLocalImage() {
    this.range = this.quill.getSelection();
    this.fileHolder = document.createElement("input");
    this.fileHolder.setAttribute("type", "file");
    // this.fileHolder.setAttribute("accept", "image/*");
    this.fileHolder.setAttribute("style", "visibility:hidden");

    this.fileHolder.onchange = this.fileChanged.bind(this);

    document.body.appendChild(this.fileHolder);

    this.fileHolder.click();

    window.requestAnimationFrame(() => {
      document.body.removeChild(this.fileHolder);
    });
  }

  handleDrop(evt) {
    evt.stopPropagation();
    evt.preventDefault();
    if (
      evt.dataTransfer &&
      evt.dataTransfer.files &&
      evt.dataTransfer.files.length
    ) {
      if (document.caretRangeFromPoint) {
        const selection = document.getSelection();
        const range = document.caretRangeFromPoint(evt.clientX, evt.clientY);
        if (selection && range) {
          selection.setBaseAndExtent(
            range.startContainer,
            range.startOffset,
            range.startContainer,
            range.startOffset
          );
        }
      } else {
        const selection = document.getSelection();
        const range = document.caretPositionFromPoint(evt.clientX, evt.clientY);
        if (selection && range) {
          selection.setBaseAndExtent(
            range.offsetNode,
            range.offset,
            range.offsetNode,
            range.offset
          );
        }
      }

      this.range = this.quill.getSelection();
      const file = evt.dataTransfer.files[0];

      setTimeout(() => {
        this.range = this.quill.getSelection();
        this.readAndUploadFile(file);
      }, 0);
    }
  }

  handlePaste(evt) {
    const clipboard = evt.clipboardData || window.clipboardData;

    // IE 11 is .files other browsers are .items
    if (clipboard && (clipboard.items || clipboard.files)) {
      const items = clipboard.items || clipboard.files;
      const IMAGE_MIME_REGEX = /^image\/(jpe?g|gif|png|svg|webp)$/i;

      for (let i = 0; i < items.length; i++) {
        if (IMAGE_MIME_REGEX.test(items[i].type)) {
          const file = items[i].getAsFile ? items[i].getAsFile() : items[i];

          if (file) {
            this.range = this.quill.getSelection();
            evt.preventDefault();
            setTimeout(() => {
              this.range = this.quill.getSelection();
              this.readAndUploadFile(file);
            }, 0);
          }
        }
      }
    }
  }

  readAndUploadFile(file) {
    //TODO: sanitize file name for prevent XSS
    if (!file) return;

    let isUploadReject = false;
    const fileReader = new FileReader();
    fileReader.addEventListener(
      "load",
      () => {
        if (!isUploadReject) {
          const base64ImageSrc = fileReader.result
          this.insertBase64Image(base64ImageSrc);
        }
      },
      false
    );

    let isImage = false
    const IMAGE_MIME_REGEX = /^image\/(jpe?g|gif|png|svg|webp)$/i;
    if (IMAGE_MIME_REGEX.test(file.type)) {
      fileReader.readAsDataURL(file);
      isImage = true
    } else {
      this.insertFileName(file.name)
    }

    this.options.upload(file).then(
      (imageUrl) => {
        if (isImage) {
          this.insertLoadedImage(imageUrl);
        } else {
          this.insertLoadedFile(file.name, imageUrl);
        }
      },
      (error) => {
        isUploadReject = true;
        this.removeInserted();
        console.warn(error);
      }
    );
  }

  fileChanged() {
    const file = this.fileHolder.files[0];
    this.readAndUploadFile(file);
  }

  insertBase64Image(url) {
    const { range } = this;
    this.quill.insertEmbed(
      range.index,
      LoadingImage.blotName,
      `${url}`,
      "user"
    );
  }

  insertFileName(name) {
    const { range } = this;
    this.quill.insertEmbed(
      range.index,
      FileBlot.blotName,
      name,
      "user"
    );
  }

  insertLoadedImage(url) {
    const { range } = this;
    this.quill.deleteText(range.index, 3, "user");
    this.quill.insertEmbed(range.index, "image", `${url}`, "user");

    range.index++;
    this.quill.setSelection(range, "user");
  }

  insertLoadedFile(fileName, url) {
    const { range } = this;
    this.quill.deleteText(range.index, fileName.length + 1, "user");
    this.quill.insertText(range.index, fileName, 'link', url, "user");

    range.index++;
    this.quill.setSelection(range, "user");
  }

  removeInserted() {
    const { range } = this;
    this.quill.deleteText(range.index, 3, "user");
  }
}

window.ImageUploader = ImageUploader;
export default ImageUploader;
