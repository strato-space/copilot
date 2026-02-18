import ReactQuill, { Quill } from 'react-quill-new';

const InlineBlot = Quill.import('blots/block');

class FileBlot extends InlineBlot {
  static create(fileName) {
    const node = super.create(fileName);
    if (fileName === true) return node;

    const placeholder = document.createElement('span');
    placeholder.textContent = fileName;
    node.appendChild(placeholder);
    return node;
  }

  deleteAt(index, length) {
    super.deleteAt(index, length);
    this.cache = {};
  }

  static value(domNode) {
    console.log("WTF: domNode:", domNode)
    const { src, custom } = domNode.dataset;
    return { src, custom };
  }
}

FileBlot.blotName = 'fileBlot';
FileBlot.tagName = 'span';
Quill.register({ 'formats/fileBlot': FileBlot });

export default FileBlot;

