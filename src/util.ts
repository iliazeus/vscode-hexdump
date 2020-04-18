import * as vscode from 'vscode';
import * as fs from 'fs';

import HexdumpContentProvider from './contentProvider';

export function getHexdumpUri(fileUri: vscode.Uri): vscode.Uri | undefined {
    if (fileUri.scheme === 'hexdump') {
        return fileUri;
    }

    return fileUri.with({
        scheme: 'hexdump',
        authority: '',
        path: fileUri.toString() + '.hexdump',
        query: '',
        fragment: '',
    });
}

export function getPhysicalUri(hexdumpUri: vscode.Uri): vscode.Uri {
    if (hexdumpUri.scheme === 'hexdump') {
        return vscode.Uri.parse(hexdumpUri.path.slice(0, -'.hexdump'.length));
    }

    return hexdumpUri;
}

export async function getFileSize(uri: vscode.Uri): Promise<number> {
    const physicalUri = getPhysicalUri(uri);
    const stat = await vscode.workspace.fs.stat(physicalUri);
    return stat.size;
}

export function getOffset(pos: vscode.Position): number {
    var config = vscode.workspace.getConfiguration('hexdump');
    var firstLine: number = config['showOffset'] ? 1 : 0;
    var hexLineLength: number = config['width'] * 2;
    var firstByteOffset: number = config['showAddress'] ? 10 : 0;
    var lastByteOffset: number = firstByteOffset + hexLineLength + hexLineLength / config['nibbles'] - 1;
    var firstAsciiOffset: number = lastByteOffset + (config['nibbles'] == 2 ? 4 : 2);

    // check if within a valid section
    if (pos.line < firstLine || pos.character < firstByteOffset) {
        return;
    }

    var offset = (pos.line - firstLine) * config['width'];
    var s = pos.character - firstByteOffset;
    if (pos.character >= firstByteOffset && pos.character <= lastByteOffset) {
        // byte section
        if (config['nibbles'] == 8) {
            offset += Math.floor(s / 9) + Math.floor((s + 2) / 9) + Math.floor((s + 4) / 9) + Math.floor((s + 6) / 9);
        } else if (config['nibbles'] == 4) {
            offset += Math.floor(s / 5) + Math.floor((s + 2) / 5);
        } else {
            offset += Math.floor(s / 3);
        }
    } else if (pos.character >= firstAsciiOffset) {
        // ascii section
        offset += pos.character - firstAsciiOffset;
    }
    return offset;
}

export function getPosition(offset: number, ascii: Boolean = false): vscode.Position {
    var config = vscode.workspace.getConfiguration('hexdump');
    var firstLine: number = config['showOffset'] ? 1 : 0;
    var hexLineLength: number = config['width'] * 2;
    var firstByteOffset: number = config['showAddress'] ? 10 : 0;
    var lastByteOffset: number = firstByteOffset + hexLineLength + hexLineLength / config['nibbles'] - 1;
    var firstAsciiOffset: number = lastByteOffset + (config['nibbles'] == 2 ? 4 : 2);

    let row = firstLine + Math.floor(offset / config['width']);
    let column = offset % config['width'];

    if (ascii) {
        column += firstAsciiOffset;
    } else {
        if (config['nibbles'] == 8) {
            column = firstByteOffset + column * 2 + Math.floor(column / 4);
        } else if (config['nibbles'] == 4) {
            column = firstByteOffset + column * 2 + Math.floor(column / 2);
        } else {
            column = firstByteOffset + column * 3;
        }
    }

    return new vscode.Position(row, column);
}

export function getRanges(startOffset: number, endOffset: number, ascii: boolean): vscode.Range[] {
    var config = vscode.workspace.getConfiguration('hexdump');
    var hexLineLength: number = config['width'] * 2;
    var firstByteOffset: number = config['showAddress'] ? 10 : 0;
    var lastByteOffset: number = firstByteOffset + hexLineLength + hexLineLength / config['nibbles'] - 1;
    var firstAsciiOffset: number = lastByteOffset + (config['nibbles'] == 2 ? 4 : 2);
    var lastAsciiOffset: number = firstAsciiOffset + config['width'];

    var startPos = getPosition(startOffset, ascii);
    var endPos = getPosition(endOffset, ascii);
    endPos = new vscode.Position(endPos.line, endPos.character + (ascii ? 1 : 2));

    var ranges = [];
    var firstOffset = ascii ? firstAsciiOffset : firstByteOffset;
    var lastOffset = ascii ? lastAsciiOffset : lastByteOffset;
    for (var i = startPos.line; i <= endPos.line; ++i) {
        var start = new vscode.Position(i, i == startPos.line ? startPos.character : firstOffset);
        var end = new vscode.Position(i, i == endPos.line ? endPos.character : lastOffset);
        ranges.push(new vscode.Range(start, end));
    }

    return ranges;
}

export interface IEntry {
    array: Uint8Array;
    isDirty: boolean;
    decorations?: vscode.Range[];
}

const dict = new Map<string, IEntry>();

export async function getContents(hexdumpUri: vscode.Uri): Promise<Uint8Array | undefined> {
    return (await getEntry(hexdumpUri)).array;
}

export async function getEntry(hexdumpUri: vscode.Uri): Promise<IEntry> {
    // ignore text files with hexdump syntax
    if (hexdumpUri.scheme !== 'hexdump') {
        return;
    }

    const physicalUri = getPhysicalUri(hexdumpUri);

    if (dict.has(physicalUri.toString())) {
        return dict.get(physicalUri.toString());
    }

    const array = await vscode.workspace.fs.readFile(physicalUri);

    // TODO: consider using a vscode.FileSystemWatcher
    fs.watch(physicalUri.fsPath, async () => {
        dict.set(physicalUri.toString(), { array: await fs.promises.readFile(physicalUri.fsPath), isDirty: false });
        HexdumpContentProvider.instance.update(hexdumpUri);
    });

    const entry = { array, isDirty: false };
    dict.set(physicalUri.toString(), entry);

    return entry;
}

export function removeEntry(hexdumpUri: vscode.Uri): void {
    const physicalUri = getPhysicalUri(hexdumpUri);

    dict.delete(physicalUri.toString());
}

export function triggerUpdateDecorations(e: vscode.TextEditor) {
    setTimeout(updateDecorations, 500, e);
}

export async function getBufferSelection(
    document: vscode.TextDocument,
    selection?: vscode.Selection
): Promise<Buffer | undefined> {
    const arr = await getContents(document.uri);
    if (typeof arr == 'undefined') {
        return;
    }

    if (selection && !selection.isEmpty) {
        let start = getOffset(selection.start);
        let end = getOffset(selection.end) + 1;
        return Buffer.from(arr.slice(start, end));
    }

    return Buffer.from(arr);
}

// create a decorator type that we use to mark modified bytes
const modifiedDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255,0,0,1)',
});

async function updateDecorations(e: vscode.TextEditor) {
    const uri = e.document.uri;
    const entry = await getEntry(uri);
    if (entry && entry.decorations) {
        e.setDecorations(modifiedDecorationType, entry.decorations);
    }
}
