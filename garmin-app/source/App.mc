using Toybox.Application;
using Toybox.Background;
using Toybox.System;
using Toybox.Time;

class App extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state as Dictionary?) as Void {
        registerBackgroundSync();
    }

    function onStop(state as Dictionary?) as Void {
    }

    function getServiceDelegate() as [System.ServiceDelegate] or Null {
        return [new BackgroundService()] as [System.ServiceDelegate];
    }

    private function registerBackgroundSync() as Void {
        try {
            Background.registerForTemporalEvent(new Time.Duration(3600));
        } catch (ex) {
            System.println("Failed to register background temporal event");
        }
    }
}

function getApp() as App {
    return Application.getApp() as App;
}
