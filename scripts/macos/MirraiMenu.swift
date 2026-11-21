// Mirrai's macOS menu bar launcher.
//
// It replaces the old `launcher.sh`, which opened Terminal.app and ran
// `start.sh` inside it. That worked, but the app lived in the Dock and
// in a terminal window, and closing the window killed the server with
// no tray to get back to.
//
// This one is a small agent app:
//
//   - it runs `Resources/start.sh` as a child and appends everything the
//     script prints to `~/Library/Application Support/Mirrai/logs/`;
//   - a menu bar item offers "打开 Mirrai", "看日志" and "退出";
//   - ⌥⌘M brings Mirrai back to the front in the browser;
//   - it is not in the Dock (`LSUIElement` in Info.plist plus
//     `.accessory` here).
//
// It is compiled by `scripts/build-macos-app.sh` with `swiftc`, which is
// part of the Xcode command line tools the build already requires.
//
// Verified to compile on this machine (see the stage's progress file);
// actually running the menu, the hot key and the child-process shutdown
// needs a real desktop session and is on the unverified list.

import AppKit
import Carbon.HIToolbox
import Foundation

final class AppDelegate: NSObject, NSApplicationDelegate {
    /// The address the start script prints when the server is up.
    private static let appURL = URL(string: "http://localhost:3000")!

    /// The framework reads `Bundle.main.resourceURL` when it runs from
    /// the .app; a plain binary is told where its resources are by the
    /// build.
    private static let resourcesURL: URL = {
        if let bundled = Bundle.main.resourceURL {
            return bundled
        }
        return URL(fileURLWithPath: CommandLine.arguments[0])
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }()

    private var statusItem: NSStatusItem?
    private var server: Process?
    private var hotKeyRef: EventHotKeyRef?
    private var hotKeyHandler: EventHandlerRef?
    private var logHandle: FileHandle?
    private var quitting = false

    private var dataRoot: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return base.appendingPathComponent("Mirrai", isDirectory: true)
    }

    private var logURL: URL {
        dataRoot.appendingPathComponent("logs/mirrai.log", isDirectory: false)
    }

    // ─── Lifecycle ────────────────────────────────────────────────────

    func applicationDidFinishLaunching(_ notification: Notification) {
        // No Dock icon and no menu bar of its own; the status item is
        // the whole interface.
        NSApp.setActivationPolicy(.accessory)
        prepareLog()
        buildStatusItem()
        registerHotKey()
        startServer()
    }

    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        stopServer()
        if let hotKeyHandler {
            RemoveEventHandler(hotKeyHandler)
        }
        if let hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
        }
    }

    // ─── The status item ──────────────────────────────────────────────

    private func buildStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            button.title = "M"
            button.toolTip = "Mirrai"
        }

        let menu = NSMenu()
        let open = NSMenuItem(title: "打开 Mirrai", action: #selector(openMirrai), keyEquivalent: "")
        open.target = self
        let logs = NSMenuItem(title: "看日志", action: #selector(openLog), keyEquivalent: "")
        logs.target = self
        let quit = NSMenuItem(title: "退出", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(open)
        menu.addItem(logs)
        menu.addItem(NSMenuItem.separator())
        menu.addItem(quit)
        item.menu = menu
        statusItem = item
    }

    @objc private func openMirrai() {
        NSWorkspace.shared.open(Self.appURL)
    }

    @objc private func openLog() {
        NSWorkspace.shared.open(logURL)
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    // ─── The global shortcut, ⌥⌘M ─────────────────────────────────────

    private func registerHotKey() {
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        // A C callback cannot capture `self`, so the delegate goes
        // through the user-data pointer.
        let callback: EventHandlerUPP = { _, _, userData in
            guard let userData else { return noErr }
            let delegate = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
            delegate.openMirrai()
            return noErr
        }
        InstallEventHandler(
            GetApplicationEventTarget(),
            callback,
            1,
            &eventType,
            Unmanaged.passUnretained(self).toOpaque(),
            &hotKeyHandler
        )
        // 'MIRR'
        let hotKeyID = EventHotKeyID(signature: OSType(0x4D495252), id: 1)
        RegisterEventHotKey(
            UInt32(cmdKey | optionKey),
            UInt32(kVK_ANSI_M),
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
    }

    // ─── The server ───────────────────────────────────────────────────

    private func prepareLog() {
        do {
            try FileManager.default.createDirectory(
                at: logURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            if !FileManager.default.fileExists(atPath: logURL.path) {
                FileManager.default.createFile(atPath: logURL.path, contents: nil)
            }
            logHandle = try FileHandle(forWritingTo: logURL)
            logHandle?.seekToEndOfFile()
        } catch {
            NSLog("[Mirrai] Could not open the log file: \(error)")
        }
    }

    private func writeLog(_ text: String) {
        guard let data = text.data(using: .utf8) else { return }
        logHandle?.write(data)
    }

    private func startServer() {
        let script = Self.resourcesURL.appendingPathComponent("start.sh")
        guard FileManager.default.isExecutableFile(atPath: script.path) else {
            writeLog("[launcher] start.sh is missing from the bundle\n")
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [script.path]
        process.currentDirectoryURL = Self.resourcesURL

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        // Everything the start script says goes into the log file; the
        // menu's "看日志" opens exactly this.
        pipe.fileHandleForReading.readabilityHandler = { [weak self] readable in
            let data = readable.availableData
            guard !data.isEmpty else { return }
            self?.logHandle?.write(data)
        }

        process.terminationHandler = { [weak self] finished in
            guard let self else { return }
            // The end of `start.sh` can be an ordinary stop (the user
            // chose 退出) or a crash. Only the second one is worth a
            // line in the log.
            if !self.quitting {
                self.writeLog("[launcher] start.sh exited with status \(finished.terminationStatus)\n")
            }
        }

        do {
            try process.run()
            server = process
            writeLog("[launcher] start.sh started (pid \(process.processIdentifier))\n")
        } catch {
            writeLog("[launcher] start.sh could not start: \(error)\n")
        }
    }

    private func stopServer() {
        guard let process = server, process.isRunning else { return }
        // `start.sh` traps TERM and stops PostgreSQL and the node server;
        // SIGKILL would leave the database half shutdown.
        process.terminate()
        let deadline = Date().addingTimeInterval(15)
        while process.isRunning && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        if process.isRunning {
            kill(process.processIdentifier, SIGKILL)
        }
    }
}

@main
struct MirraiMenu {
    static let delegate = AppDelegate()

    static func main() {
        let app = NSApplication.shared
        app.delegate = delegate
        app.run()
    }
}
