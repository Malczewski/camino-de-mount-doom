using Toybox.Application;
using Toybox.Background;
using Toybox.Communications;
using Toybox.Lang;
using Toybox.System;
using Toybox.Time;

const SETTINGS_URL = "https://camino-de-mount-doom.netlify.app/garmin-auth.html";

class App extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state as Lang.Dictionary?) as Void {
        registerBackgroundSync();
        var apiKey = Application.Storage.getValue("api_key");
        if (apiKey == null || !(apiKey instanceof Lang.String) || (apiKey as Lang.String).length() == 0) {
            Communications.openWebPage(SETTINGS_URL, null, null);
        }
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
            System.println("Failed to register background temporal event");
        }
    }
}

function getApp() as App {
    return Application.getApp() as App;
}
