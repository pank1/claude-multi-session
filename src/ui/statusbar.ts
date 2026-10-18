import * as vscode from 'vscode';

import { Controller } from '../controller';
import { bindingWindow } from '../core/usage';
import { statusBarText, tooltipMarkdown } from './format';

/**
 * One status bar item. It is the whole product for most people: the account in
 * use, how much is left, and when it comes back.
 */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly claudeMultiSession: Controller) {
    const configuration = vscode.workspace.getConfiguration();
    const alignment =
      configuration.get<string>('claudeMultiSession.statusBar.alignment', 'right') === 'left'
        ? vscode.StatusBarAlignment.Left
        : vscode.StatusBarAlignment.Right;
    const priority = configuration.get<number>('claudeMultiSession.statusBar.priority', 100);

    this.item = vscode.window.createStatusBarItem('claudeMultiSession.status', alignment, priority);
    this.item.name = 'Claude Multi Session';
    this.item.command = 'claudeMultiSession.switch';
    this.disposables.push(this.item, claudeMultiSession.onDidChange(() => this.render()));
    this.render();
  }

  render(): void {
    const configuration = vscode.workspace.getConfiguration();
    if (!configuration.get<boolean>('claudeMultiSession.statusBar.enabled', true)) {
      this.item.hide();
      return;
    }

    const views = this.claudeMultiSession.views();
    const active = views.find((view) => view.isActive);

    this.item.text = statusBarText(active, {
      showWeekly: configuration.get<boolean>('claudeMultiSession.statusBar.showWeekly', true),
      showAccountName: configuration.get<boolean>('claudeMultiSession.statusBar.showAccountName', true),
      locked: this.claudeMultiSession.sync.enabled && this.claudeMultiSession.passphrase.locked,
    });

    const tooltip = new vscode.MarkdownString(tooltipMarkdown(views));
    tooltip.isTrusted = true;
    tooltip.supportThemeIcons = true;
    this.item.tooltip = tooltip;

    // Backgrounds are shouty, so only a spent or nearly spent window earns one.
    const severity = active?.snapshot ? bindingWindow(active.snapshot).usage.severity : 'normal';
    this.item.backgroundColor =
      severity === 'exhausted'
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : severity === 'critical'
          ? new vscode.ThemeColor('statusBarItem.warningBackground')
          : undefined;

    this.item.show();
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }
}
