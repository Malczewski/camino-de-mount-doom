using Toybox.ActivityMonitor;
using Toybox.Application;
using Toybox.Communications;
using Toybox.Lang;
using Toybox.System;
using Toybox.Time;

(:background)
module StepSync {

    const EDGE_FUNCTION_URL = "https://wpkwqhbrvphjppfquqby.supabase.co/functions/v1/step-sync";

    function sync() as Void {
        var apiKey = Application.getApp().getProperty("api_key");

        if (apiKey == null || !(apiKey instanceof String) || (apiKey as String).length() == 0) {
            return;
        }

        var info = ActivityMonitor.getInfo();
        if (info == null || info.steps == null) {
            return;
        }

        var steps = info.steps;
        if (steps < 0) {
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

        try {
            Communications.makeWebRequest(
                EDGE_FUNCTION_URL,
                payload,
                options,
                method(:onWebResponse)
            );
        } catch (ex) {
            System.println("Step sync request failed to start");
        }
    }

    function onWebResponse(responseCode as Number, data as Dictionary or String or Null) as Void {
        if (responseCode < 200 || responseCode >= 300) {
            System.println("Step sync failed with status " + responseCode);
        }
    }

    private function todayIsoString() as String {
        var now = Time.now();
        var info = Time.Gregorian.info(now, Time.FORMAT_SHORT);

        return Lang.format("$1$-$2$-$3$", [
            info.year.format("%04d"),
            info.month.format("%02d"),
            info.day.format("%02d")
        ]);
    }
}
