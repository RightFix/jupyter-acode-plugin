import plugin from '../plugin.json';
import { marked } from 'marked';
import tag from 'html-tag-js';
import notebookStyles from './styles.css';

const CELL_TYPES = {
  CODE: 'code',
  MARKDOWN: 'markdown'
};

const PAIRS = {
  '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`'
};

class JupyterNotebook {
  baseUrl = '';
  notebookData = null;
  currentFile = null;
  currentFileName = null;
  $container = null;
  $cells = null;
  selectedCellIndex = -1;
  isModified = false;
  notebooks = new Map();

  init(baseUrl) {
    this.baseUrl = baseUrl;
    this.registerCommands();
    this.registerFileHandler();
  }

  registerCommands() {
    const { commands } = editorManager.editor;
    commands.addCommand({
      name: 'open-notebook-viewer',
      description: 'Open Jupyter Notebook',
      exec: () => this.openNotebookPicker()
    });
  }

  registerFileHandler() {
    acode.registerFileHandler(plugin.id, {
      extensions: ['ipynb'],
      handleFile: async (fileInfo) => {
        await this.openNotebookFile(fileInfo.uri, fileInfo.name);
      }
    });
  }

  async openNotebookPicker() {
    try {
      const result = await acode.fileBrowser('file', 'Select notebook');
      if (result && result.url) {
        await this.openNotebookFile(result.url, result.filename || 'notebook.ipynb');
      }
    } catch (error) {
      acode.alert('Error', error.message);
    }
  }

  async openNotebookFile(uri, filename) {
    try {
      const loader = acode.loader('Loading...', 'Please wait');
      loader.show();

      const content = await acode.fsOperation(uri).readFile('utf-8');
      const notebookData = JSON.parse(content);
      loader.hide();

      this.currentFile = uri;
      this.currentFileName = filename || 'notebook.ipynb';
      this.notebookData = notebookData;
      this.selectedCellIndex = -1;
      this.isModified = false;

      this.render();

    } catch (error) {
      acode.alert('Error', `Failed to open: ${error.message}`);
    }
  }

  render() {
    // Remove existing container if any
    const existing = document.querySelector('.jupyter-notebook-wrapper');
    if (existing) existing.remove();

    // Create wrapper
    const wrapper = tag('div', {
      className: 'jupyter-notebook-wrapper',
      style: {
        position: 'fixed',
        top: '44px',
        left: '0',
        right: '0',
        bottom: '0',
        background: '#fff',
        zIndex: '1',
        overflow: 'auto'
      }
    });

    // Add styles
    const style = tag('style', { textContent: notebookStyles });
    wrapper.appendChild(style);

    // Toolbar
    const toolbar = tag('div', {
      className: 'nb-toolbar',
      innerHTML: `
        <button class="nb-btn add-code">+ Code</button>
        <button class="nb-btn add-md">+ Markdown</button>
        <button class="nb-btn run-all">Run All</button>
        <button class="nb-btn save">Save</button>
      `
    });
    toolbar.querySelector('.add-code').onclick = () => this.addCell(CELL_TYPES.CODE);
    toolbar.querySelector('.add-md').onclick = () => this.addCell(CELL_TYPES.MARKDOWN);
    toolbar.querySelector('.run-all').onclick = () => this.runAllCells();
    toolbar.querySelector('.save').onclick = () => this.saveNotebook();
    wrapper.appendChild(toolbar);

    // Cells container
    this.$cells = tag('div', { className: 'nb-cells' });
    this.renderCells();
    wrapper.appendChild(this.$cells);

    // Add to page
    const main = document.querySelector('main') || document.body;
    main.appendChild(wrapper);
    this.$container = wrapper;

    // Hide editor
    this.hideEditor();
  }

  hideEditor() {
    const editorEl = document.getElementById('editor');
    if (editorEl) editorEl.style.display = 'none';
    const editorsEl = document.getElementById('editors');
    if (editorsEl) editorsEl.style.display = 'none';
  }

  showEditor() {
    const editorEl = document.getElementById('editor');
    if (editorEl) editorEl.style.display = '';
    const editorsEl = document.getElementById('editors');
    if (editorsEl) editorsEl.style.display = '';
  }

  renderCells() {
    this.$cells.innerHTML = '';

    if (!this.notebookData?.cells?.length) {
      this.$cells.innerHTML = '<div class="nb-empty">No cells. Add a cell to start.</div>';
      return;
    }

    this.notebookData.cells.forEach((cell, index) => {
      this.$cells.appendChild(this.createCellElement(cell, index));
    });
  }

  createCellElement(cell, index) {
    const isSelected = index === this.selectedCellIndex;
    const cellEl = tag('div', {
      className: `nb-cell nb-${cell.cell_type}${isSelected ? ' selected' : ''}`,
      dataset: { index }
    });

    // Cell actions
    const actions = tag('div', {
      className: 'nb-cell-actions',
      innerHTML: `<span class="nb-run">▶</span><span class="nb-delete">×</span>`
    });
    actions.querySelector('.nb-run').onclick = (e) => { e.stopPropagation(); this.runCell(index); };
    actions.querySelector('.nb-delete').onclick = (e) => { e.stopPropagation(); this.deleteCell(index); };
    cellEl.appendChild(actions);

    // Prompt
    if (cell.cell_type === 'code') {
      const execCount = cell.execution_count || ' ';
      const prompt = tag('div', {
        className: 'nb-prompt',
        innerHTML: `In&nbsp;[${execCount}]:`
      });
      cellEl.appendChild(prompt);
    }

    // Content
    const content = tag('div', { className: 'nb-cell-content' });

    if (cell.cell_type === 'markdown') {
      const preview = tag('div', { className: 'nb-markdown-preview' });
      try {
        preview.innerHTML = marked.parse(this.getSource(cell.source));
      } catch (e) {
        preview.textContent = this.getSource(cell.source);
      }

      const editor = tag('textarea', {
        className: 'nb-editor',
        value: this.getSource(cell.source),
        style: { display: 'none' },
        spellcheck: false
      });

      content.appendChild(preview);
      content.appendChild(editor);

      preview.onclick = () => {
        preview.style.display = 'none';
        editor.style.display = 'block';
        editor.focus();
      };
      editor.onblur = () => {
        editor.style.display = 'none';
        preview.style.display = 'block';
        try {
          preview.innerHTML = marked.parse(editor.value);
        } catch (e) {
          preview.textContent = editor.value;
        }
        cell.source = editor.value.split('\n');
        this.isModified = true;
      };
      this.setupEditor(editor);
    } else {
      const editor = tag('textarea', {
        className: 'nb-editor nb-code-editor',
        value: this.getSource(cell.source),
        spellcheck: false
      });
      content.appendChild(editor);
      editor.onfocus = () => this.selectCell(index);
      editor.oninput = () => {
        cell.source = editor.value.split('\n');
        this.isModified = true;
      };
      this.setupEditor(editor);
    }

    cellEl.appendChild(content);

    // Outputs
    if (cell.cell_type === 'code' && cell.outputs?.length) {
      const outputsEl = tag('div', { className: 'nb-outputs' });
      cell.outputs.forEach(output => {
        outputsEl.appendChild(tag('div', {
          className: 'nb-output',
          innerHTML: this.renderOutput(output)
        }));
      });
      cellEl.appendChild(outputsEl);
    }

    cellEl.onclick = () => this.selectCell(index);

    return cellEl;
  }

  setupEditor(editor) {
    editor.addEventListener('keydown', (e) => {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const val = editor.value;

      // Auto-close
      if (PAIRS[e.key]) {
        e.preventDefault();
        const closing = PAIRS[e.key];
        const selected = val.substring(start, end);
        editor.value = val.substring(0, start) + e.key + selected + closing + val.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 1;
        return;
      }

      // Enter - auto indent
      if (e.key === 'Enter') {
        e.preventDefault();
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        const line = val.substring(lineStart, start);
        const indent = line.match(/^\s*/)[0];
        let extra = '';
        if (line.trim().endsWith(':')) extra = '    ';
        editor.value = val.substring(0, start) + '\n' + indent + extra + val.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 1 + indent.length + extra.length;
        return;
      }

      // Backspace - delete pair
      if (e.key === 'Backspace') {
        const before = val.substring(start - 1, start);
        const after = val.substring(start, start + 1);
        if (PAIRS[before] === after) {
          e.preventDefault();
          editor.value = val.substring(0, start - 1) + val.substring(start + 1);
          editor.selectionStart = editor.selectionEnd = start - 1;
        }
        return;
      }

      // Tab
      if (e.key === 'Tab') {
        e.preventDefault();
        editor.value = val.substring(0, start) + '    ' + val.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 4;
      }
    });
  }

  getSource(source) {
    if (typeof source === 'string') return source;
    if (Array.isArray(source)) return source.join('');
    return '';
  }

  renderOutput(output) {
    if (output.output_type === 'stream') {
      return `<pre>${this.escapeHtml(output.text || '')}</pre>`;
    }
    if (output.output_type === 'error') {
      return `<pre class="nb-error">${this.escapeHtml(output.traceback?.join('\n') || output.evalue)}</pre>`;
    }
    if (output.data?.['text/plain']) {
      return `<pre>${this.escapeHtml(output.data['text/plain'])}</pre>`;
    }
    return '';
  }

  escapeHtml(text) {
    if (Array.isArray(text)) text = text.join('');
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  selectCell(index) {
    this.selectedCellIndex = index;
    const cells = this.$cells.querySelectorAll('.nb-cell');
    cells.forEach((cell, i) => {
      cell.classList.toggle('selected', i === index);
    });
  }

  addCell(type) {
    if (!this.notebookData) {
      this.notebookData = { cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 };
    }

    const newCell = {
      cell_type: type,
      source: [],
      metadata: {}
    };
    if (type === 'code') {
      newCell.outputs = [];
      newCell.execution_count = null;
    }

    const insertIndex = this.selectedCellIndex >= 0 ? this.selectedCellIndex + 1 : this.notebookData.cells.length;
    this.notebookData.cells.splice(insertIndex, 0, newCell);

    this.renderCells();
    this.selectCell(insertIndex);
    this.isModified = true;

    setTimeout(() => {
      const editor = this.$cells.querySelector(`[data-index="${insertIndex}"] .nb-editor`);
      if (editor) editor.focus();
    }, 50);
  }

  deleteCell(index = this.selectedCellIndex) {
    if (!this.notebookData || this.notebookData.cells.length <= 1) {
      acode.alert('Cannot Delete', 'Need at least one cell');
      return;
    }
    this.notebookData.cells.splice(index, 1);
    this.renderCells();
    this.selectCell(Math.min(index, this.notebookData.cells.length - 1));
    this.isModified = true;
  }

  async runCell(index) {
    const cell = this.notebookData.cells[index];
    if (cell.cell_type !== 'code') return;

    const cellEl = this.$cells.querySelector(`[data-index="${index}"]`);
    const prompt = cellEl.querySelector('.nb-prompt');
    if (prompt) prompt.innerHTML = 'In&nbsp;[*]:';

    const outputsEl = cellEl.querySelector('.nb-outputs');
    if (outputsEl) outputsEl.remove();

    const content = cellEl.querySelector('.nb-cell-content');
    const editor = content.querySelector('.nb-editor');
    const code = editor.value.trim();

    if (!code) return;

    const newOutputs = tag('div', { className: 'nb-outputs' });
    newOutputs.innerHTML = '<div class="nb-output nb-running">Running...</div>';
    cellEl.appendChild(newOutputs);

    try {
      const result = await this.executeCode(code);
      cell.outputs = result.outputs || [];
      cell.execution_count = result.execution_count || Date.now();

      if (prompt) prompt.innerHTML = `In&nbsp;[${cell.execution_count}]:`;

      newOutputs.innerHTML = '';
      cell.outputs.forEach(output => {
        newOutputs.appendChild(tag('div', {
          className: 'nb-output',
          innerHTML: this.renderOutput(output)
        }));
      });

      this.isModified = true;
    } catch (error) {
      newOutputs.innerHTML = `<div class="nb-output nb-error">${this.escapeHtml(error.message)}</div>`;
    }
  }

  async runAllCells() {
    const codeCells = this.notebookData.cells
      .map((c, i) => c.cell_type === 'code' ? i : -1)
      .filter(i => i >= 0);

    for (const index of codeCells) {
      await this.runCell(index);
    }
  }

  async executeCode(code) {
    if (typeof Executor === 'undefined') {
      return {
        outputs: [{
          output_type: 'error',
          evalue: 'Terminal not available. Install Acode Terminal plugin.',
          traceback: ['Executor not found']
        }],
        execution_count: null
      };
    }

    try {
      // Simple execution via terminal
      const result = await Executor.execute(`python3 -c ${JSON.stringify(code)} 2>&1`, true);

      if (result.includes('not found') || result.includes('command not found')) {
        return {
          outputs: [{
            output_type: 'error',
            evalue: 'Python not installed. Run: apk add python3',
            traceback: ['Install Python in terminal: apk add python3']
          }],
          execution_count: null
        };
      }

      return {
        outputs: [{
          output_type: 'stream',
          text: result
        }],
        execution_count: Date.now()
      };
    } catch (error) {
      return {
        outputs: [{
          output_type: 'error',
          evalue: error.message,
          traceback: [error.message]
        }],
        execution_count: null
      };
    }
  }

  async saveNotebook() {
    if (!this.currentFile) {
      acode.alert('Info', 'Cannot save: no file path');
      return;
    }

    try {
      await acode.fsOperation(this.currentFile).writeFile(
        JSON.stringify(this.notebookData, null, 2)
      );
      this.isModified = false;
      if (acode.toast) acode.toast('Saved!', 2000);
    } catch (error) {
      acode.alert('Error', `Failed to save: ${error.message}`);
    }
  }

  destroy() {
    const { commands } = editorManager.editor;
    commands.removeCommand('open-notebook-viewer');
    acode.unregisterFileHandler(plugin.id);

    if (this.$container) {
      this.$container.remove();
    }
    this.showEditor();
  }
}

if (window.acode) {
  const jupyterPlugin = new JupyterNotebook();

  acode.setPluginInit(plugin.id, (baseUrl) => {
    if (!baseUrl.endsWith('/')) baseUrl += '/';
    jupyterPlugin.init(baseUrl);
  });

  acode.setPluginUnmount(plugin.id, () => {
    jupyterPlugin.destroy();
  });
}
