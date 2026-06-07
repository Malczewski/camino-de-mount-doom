using Toybox.ActivityMonitor;
using Toybox.Application;
using Toybox.Communications;
using Toybox.Lang;
using Toybox.System;
using Toybox.Time;

(:background)
module StepSync {

    const EDGE_FUNCTION_URL = "https://wpkwqhbrvphjppfquqby.supabase.co/functions/v1/step-sync";
    const DEBUG = false;

    function log(message as Lang.String) as Void {
        if (DEBUG) {
            System.println(message);
        }
    }

    function sync(callback as Lang.Method) as Void {
        log("sync() called");
        var apiKey = Application.Properties.getValue("api_key");

        if (apiKey == null || !(apiKey instanceof Lang.String) || (apiKey as Lang.String).length() == 0) {
            log("sync() aborted: no api key");
            return;
        }

        var info;
        try {
            info = ActivityMonitor.getInfo();
        } catch (ex instanceof Lang.Exception) {
            log("ActivityMonitor.getInfo() failed: " + ex.getErrorMessage());
            return;
        }
        if (info == null || info.steps == null) {
            log("sync() aborted: no step info");
            return;
        }

        var steps = info.steps;
        if (steps < 0) {
            log("sync() aborted: negative steps");
            return;
        }

        var payload = {
            "steps" => steps,
            "date" => todayIsoString(),
            "api_key" => apiKey
        };

        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        log("makeWebRequest steps=" + steps + " date=" + payload["date"]);
        try {
            Communications.makeWebRequest(
                EDGE_FUNCTION_URL,
                payload,
                options,
                callback
            );
        } catch (ex) {
            log("Step sync request failed to start: " + ex.getErrorMessage());
        }
    }

    function todayIsoString() as Lang.String {
        var now = Time.now();
        var info = Time.Gregorian.info(now, Time.FORMAT_SHORT);

        return Lang.format("$1$-$2$-$3$", [
            info.year.format("%04d"),
            info.month.format("%02d"),
            info.day.format("%02d")
        ]);
    }
}
