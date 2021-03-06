'use strict';

import * as vscode from 'vscode';
import { sprintf } from 'sprintf-js';

import { getFileSize, getContents } from './util';

var hexdump = require('hexy');

export default class HexdumpContentProvider implements vscode.TextDocumentContentProvider {
    private static s_instance: HexdumpContentProvider = null;
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    constructor() {
        if (HexdumpContentProvider.s_instance) {
            HexdumpContentProvider.s_instance.dispose();
        }
        HexdumpContentProvider.s_instance = this;
    }

    static get instance() {
        return HexdumpContentProvider.s_instance;
    }

    public dispose() {
        this._onDidChange.dispose();
        if (HexdumpContentProvider.s_instance) {
            HexdumpContentProvider.s_instance.dispose();
            HexdumpContentProvider.s_instance = null;
        }
    }

    public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const config = vscode.workspace.getConfiguration('hexdump');
        const sizeWarning = config['sizeWarning'];
        const sizeDisplay = config['sizeDisplay'];

        let hexyFmt = {
            format: config['nibbles'] == 8 ? 'eights' : config['nibbles'] == 4 ? 'fours' : 'twos',
            width: config['width'],
            caps: config['uppercase'] ? 'upper' : 'lower',
            numbering: config['showAddress'] ? 'hex_digits' : 'none',
            annotate: config['showAscii'] ? 'ascii' : 'none',
            length: sizeDisplay,
        };

        let header = config['showOffset'] ? this.getHeader() : '';
        let tail = '(Reached the maximum size to display. You can change "hexdump.sizeDisplay" in your settings.)';

        let proceed =
            (await getFileSize(uri)) < sizeWarning
                ? 'Open'
                : await vscode.window.showWarningMessage(
                      'File might be too big, are you sure you want to continue?',
                      { modal: true },
                      'Open',
                      'Cancel'
                  );
        if (proceed == 'Open') {
            let array = await getContents(uri);
            let hexString = header;
            hexString += hexdump.hexy(array, hexyFmt).toString();
            if (array.length > sizeDisplay) {
                hexString += tail;
            }

            return hexString;
        } else {
            return '(hexdump cancelled.)';
        }
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public update(uri: vscode.Uri) {
        this._onDidChange.fire(uri);
    }

    private getHeader(): string {
        const config = vscode.workspace.getConfiguration('hexdump');
        let header = config['showAddress'] ? '  Offset: ' : '';

        for (var i = 0; i < config['width']; ++i) {
            header += sprintf('%02X', i);
            if ((i + 1) % (config['nibbles'] / 2) == 0) {
                header += ' ';
            }
        }

        header += '\t\n';
        return header;
    }
}
