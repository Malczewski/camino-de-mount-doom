using Toybox.Application;
using Toybox.Background;
using Toybox.Lang;
using Toybox.System;
using Toybox.Time;
using Toybox.WatchUi;

class App extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        return [new AppView(), new AppInputDelegate()];
    }

    function onStart(state as Lang.Dictionary?) as Void {
        registerBackgroundSync();
    }

    function onStop(state as Lang.Dictionary?) as Void {
    }

    function getServiceDelegate() as [System.ServiceDelegate] {
        return [new BackgroundService()] as [System.ServiceDelegate];
    }

    private function registerBackgroundSync() as Void {
        try {
            Background.registerForTemporalEvent(new Time.Duration(3600));
        } catch (ex) {
            Logger.log("Failed to register background temporal event");
        }
    }
}

function getApp() as App {
    return Application.getApp() as App;
}
