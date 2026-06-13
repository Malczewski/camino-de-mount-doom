using Toybox.ActivityMonitor;
using Toybox.Application;
using Toybox.Communications;
using Toybox.Lang;
using Toybox.Time;
using Toybox.Time.Gregorian;

(:background)
module StepSync {

    const EDGE_FUNCTION_URL = "https://wpkwqhbrvphjppfquqby.supabase.co/functions/v1/step-sync";
    const LAST_SYNC_DATE_KEY = "last_sync_date";
    function sync(callback as Lang.Method) as Void {
        Logger.log("sync() called");

        var share = Application.Properties.getValue("share_steps");
        if (!(share instanceof Lang.Boolean) || !(share as Lang.Boolean)) {
            Logger.log("sync() aborted: sharing disabled");
            return;
        }

        var apiKey = Application.Properties.getValue("api_key");
        if (apiKey == null || !(apiKey instanceof Lang.String) || (apiKey as Lang.String).length() == 0) {
            Logger.log("sync() aborted: no api key");
            return;
        }

        var dates = buildDatePayloads();
        if (dates.size() == 0) {
            Logger.log("sync() aborted: no step data");
            return;
        }

        var payload = {
            "dates" => dates,
            "api_key" => apiKey
        };

        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        Logger.log("makeWebRequest with " + dates.size() + " date(s)");
        try {
            Communications.makeWebRequest(EDGE_FUNCTION_URL, payload, options, callback);
        } catch (ex instanceof Lang.Exception) {
            Logger.log("Step sync request failed: " + ex.getErrorMessage());
        }
    }

    function buildDatePayloads() as Lang.Array {
        var results = new [0];
        var today = todayIsoString();
        var lastSync = Application.Storage.getValue(LAST_SYNC_DATE_KEY);

        var missedDays = 0;
        if (lastSync instanceof Lang.String) {
            missedDays = daysBetween(lastSync as Lang.String, today);
        }

        // Back-fill missing days from ActivityMonitor history (up to 7 days).
        // Uses >= 1 so yesterday is always re-synced with its final full-day count,
        // covering steps taken after the previous sync run.
        if (missedDays >= 1) {
            var maxFill = missedDays < 8 ? missedDays : 7;
            try {
                var history = ActivityMonitor.getHistory();
                if (history instanceof Lang.Array) {
                    var histArr = history as Lang.Array;
                    var limit = histArr.size() < maxFill ? histArr.size() : maxFill;
                    for (var j = 0; j < limit; j++) {
                        var entry = histArr[j];
                        if (entry != null && entry.steps != null && entry.steps >= 0) {
                            results.add({
                                "date" => isoStringDaysAgo(j + 1),
                                "steps" => entry.steps
                            });
                        }
                    }
                }
            } catch (ex instanceof Lang.Exception) {
                Logger.log("History unavailable: " + ex.getErrorMessage());
            }
        }

        try {
            var info = ActivityMonitor.getInfo();
            if (info != null && info.steps != null && info.steps >= 0) {
                results.add({"date" => today, "steps" => info.steps});
            }
        } catch (ex instanceof Lang.Exception) {
            Logger.log("getInfo() failed: " + ex.getErrorMessage());
        }

        return results;
    }

    function markSynced() as Void {
        Application.Storage.setValue(LAST_SYNC_DATE_KEY, todayIsoString());
    }

    function todayIsoString() as Lang.String {
        var now = Time.now();
        var info = Gregorian.info(now, Time.FORMAT_SHORT);
        return Lang.format("$1$-$2$-$3$", [
            info.year.format("%04d"),
            info.month.format("%02d"),
            info.day.format("%02d")
        ]);
    }

    function isoStringDaysAgo(days as Lang.Number) as Lang.String {
        var moment = Time.now().subtract(new Time.Duration(days * 86400));
        var info = Gregorian.info(moment, Time.FORMAT_SHORT);
        return Lang.format("$1$-$2$-$3$", [
            info.year.format("%04d"),
            info.month.format("%02d"),
            info.day.format("%02d")
        ]);
    }

    function daysBetween(earlier as Lang.String, later as Lang.String) as Lang.Number {
        var em = parseIsoToMoment(earlier);
        var lm = parseIsoToMoment(later);
        if (em == null || lm == null) { return 0; }
        var diff = lm.subtract(em);
        return (diff.value() / 86400).toNumber();
    }

    function parseIsoToMoment(dateStr as Lang.String) as Time.Moment or Null {
        if (dateStr == null || dateStr.length() < 10) { return null; }
        var y = dateStr.substring(0, 4).toNumber();
        var m = dateStr.substring(5, 7).toNumber();
        var d = dateStr.substring(8, 10).toNumber();
        if (y == null || m == null || d == null) { return null; }
        return Gregorian.moment({:year => y, :month => m, :day => d, :hour => 12, :minute => 0, :second => 0});
    }
}
