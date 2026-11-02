//! The native alerts the shell shows, and the OS version check that may need
//! one. All must run on the main thread.
//!
//!   alert   modal, for what stops the app or a menu action: never shown
//!           while the vault is in use (the vault never shows UI itself)
//!   notice  NON-modal, for the keychain notice: shown and left, nothing
//!           waits on it, no nested run loop

/// A modal alert with an OK button. Also written to stderr, so a run from a
/// terminal says the same thing.
pub fn alert(title: &str, message: &str) {
    eprintln!("[mantle-desktop] {title}: {message}");
    #[cfg(target_os = "macos")]
    {
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSAlert;
        use objc2_foundation::NSString;
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let alert = NSAlert::new(mtm);
        alert.setMessageText(&NSString::from_str(title));
        alert.setInformativeText(&NSString::from_str(message));
        alert.runModal();
    }
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;
        let dialog = gtk::MessageDialog::new(
            None::<&gtk::Window>,
            gtk::DialogFlags::MODAL,
            gtk::MessageType::Warning,
            gtk::ButtonsType::Ok,
            message,
        );
        dialog.set_title(title);
        dialog.run();
        dialog.close();
    }
}

/// A non-modal notice with an OK button: shown, and the call returns at
/// once. Also written to stderr.
pub fn notice(title: &str, message: &str) {
    eprintln!("[mantle-desktop] {title}: {message}");
    #[cfg(target_os = "macos")]
    {
        use objc2::runtime::AnyObject;
        use objc2::{sel, MainThreadMarker};
        use objc2_app_kit::{NSAlert, NSFloatingWindowLevel};
        use objc2_foundation::NSString;
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let alert = NSAlert::new(mtm);
        alert.setMessageText(&NSString::from_str(title));
        alert.setInformativeText(&NSString::from_str(message));
        let ok = alert.addButtonWithTitle(&NSString::from_str("OK"));
        alert.layout();
        // Not runModal and not a sheet: the alert's own panel, shown as a
        // plain window. OK (or Return) hides it; nothing waits on it.
        let window = alert.window();
        let target: &AnyObject = window.as_ref();
        // SAFETY: the target is the panel itself, kept alive by the alert
        // (leaked below), and orderOut: is an NSWindow action taking a sender.
        unsafe {
            ok.setTarget(Some(target));
            ok.setAction(Some(sel!(orderOut:)));
        }
        window.setLevel(NSFloatingWindowLevel);
        window.center();
        window.makeKeyAndOrderFront(None);
        // Shown once per run: the alert (and so its panel) lives to the end.
        std::mem::forget(alert);
    }
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;
        let dialog = gtk::MessageDialog::new(
            None::<&gtk::Window>,
            gtk::DialogFlags::empty(),
            gtk::MessageType::Warning,
            gtk::ButtonsType::Ok,
            message,
        );
        dialog.set_title(title);
        dialog.set_keep_above(true);
        dialog.connect_response(|dialog, _| dialog.close());
        dialog.show();
    }
}

/// The macOS major version, read the way wry reads it to decide whether a
/// per-window data store exists (NSProcessInfo.operatingSystemVersion).
#[cfg(target_os = "macos")]
pub fn macos_major() -> isize {
    objc2_foundation::NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
}
