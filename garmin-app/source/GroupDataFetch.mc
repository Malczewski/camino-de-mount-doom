using Toybox.Communications;
using Toybox.Lang;
using Toybox.System;

// Foreground-only module: fetches group progress data from the server.
// Not annotated (:background) so it stays out of the background service build.
module GroupDataFetch {

    const URL = "https://wpkwqhbrvphjppfquqby.supabase.co/functions/v1/get-group-data";

    function fetch(apiKey as Lang.String, callback as Lang.Method) as Void {
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        try {
            Communications.makeWebRequest(
                URL,
                {"api_key" => apiKey},
                options,
                callback
            );
        } catch (ex instanceof Lang.Exception) {
            System.println("GroupDataFetch.fetch failed: " + ex.getErrorMessage());
        }
    }
}
