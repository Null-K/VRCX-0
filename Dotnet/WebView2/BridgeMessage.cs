using System.Text.Json.Serialization;

namespace VRCX_0
{
    public class BridgeRequest
    {
        [JsonPropertyName("id")]
        public string Id { get; set; }

        [JsonPropertyName("method")]
        public string Method { get; set; }

        [JsonPropertyName("args")]
        public object[] Args { get; set; }
    }

    public class BridgeResponse
    {
        [JsonPropertyName("id")]
        public string Id { get; set; }

        [JsonPropertyName("result")]
        public object Result { get; set; }

        [JsonPropertyName("error")]
        public string Error { get; set; }
    }

    public class BridgeEvent
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "event";

        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("data")]
        public object Data { get; set; }
    }
}
