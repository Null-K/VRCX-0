using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Reflection;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using NLog;

namespace VRCX_0
{
    public class MessageRouter
    {
        private static readonly Logger logger = LogManager.GetCurrentClassLogger();
        private readonly ConcurrentDictionary<string, object> _services = new();
        private readonly ConcurrentDictionary<string, List<MethodInfo>> _methodCache = new();
        private CoreWebView2 _webView;

        public void SetWebView(CoreWebView2 webView)
        {
            _webView = webView;
        }

        public void Register(string name, object instance)
        {
            _services[name] = instance;

            // Pre-cache all public instance methods, including base class members.
            var type = instance.GetType();
            foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Instance))
            {
                if (method.IsSpecialName || method.DeclaringType == typeof(object))
                    continue;

                var key = $"{name}.{method.Name}";
                _methodCache.AddOrUpdate(
                    key,
                    _ => new List<MethodInfo> { method },
                    (_, list) =>
                    {
                        list.Add(method);
                        return list;
                    });
            }
        }

        public async void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string json = null;
            try
            {
                json = e.WebMessageAsJson;
                var request = JsonSerializer.Deserialize<BridgeRequest>(json);
                if (request?.Method == null || request.Id == null)
                    return;

                await HandleRequest(request);
            }
            catch (Exception ex)
            {
                logger.Error(ex, "Error processing web message: {0}", json?.Substring(0, Math.Min(json?.Length ?? 0, 200)));
            }
        }

        private async Task HandleRequest(BridgeRequest request)
        {
            try
            {
                if (!_methodCache.TryGetValue(request.Method, out var methods))
                {
                    SendError(request.Id, $"Method not found: {request.Method}");
                    return;
                }

                var dotIndex = request.Method.IndexOf('.');
                var serviceName = request.Method.Substring(0, dotIndex);
                if (!_services.TryGetValue(serviceName, out var service))
                {
                    SendError(request.Id, $"Service not found: {serviceName}");
                    return;
                }

                if (!TrySelectMethod(methods, request.Args, out var method, out var args))
                {
                    SendError(request.Id, $"No matching overload for: {request.Method}");
                    return;
                }

                object result;
                try
                {
                    result = method.Invoke(service, args);
                }
                catch (TargetInvocationException tie)
                {
                    SendError(request.Id, tie.InnerException?.Message ?? tie.Message);
                    return;
                }

                // Handle async methods
                if (result is Task task)
                {
                    await task;
                    var taskType = task.GetType();
                    if (taskType.IsGenericType)
                    {
                        var resultProperty = taskType.GetProperty("Result");
                        result = resultProperty?.GetValue(task);
                    }
                    else
                    {
                        result = null;
                    }
                }

                SendResponse(request.Id, result);
            }
            catch (Exception ex)
            {
                logger.Error(ex, "Error handling request: {0}", request.Method);
                SendError(request.Id, ex.Message);
            }
        }

        private static bool TrySelectMethod(
            List<MethodInfo> methods,
            object[] rawArgs,
            out MethodInfo selected,
            out object[] args)
        {
            selected = null;
            args = null;

            var bestScore = int.MinValue;
            var bestParamCount = int.MaxValue;
            foreach (var method in methods)
            {
                var parameters = method.GetParameters();
                if (!TryConvertArgs(rawArgs, parameters, out var converted, out var score))
                    continue;

                if (score > bestScore || (score == bestScore && parameters.Length < bestParamCount))
                {
                    bestScore = score;
                    bestParamCount = parameters.Length;
                    selected = method;
                    args = converted;
                }
            }

            return selected != null;
        }

        private static bool TryConvertArgs(object[] rawArgs, ParameterInfo[] parameters, out object[] converted, out int score)
        {
            score = 0;
            converted = null;

            if (rawArgs != null && rawArgs.Length > parameters.Length)
                return false;

            if (rawArgs == null || rawArgs.Length == 0)
            {
                // Fill default values for optional parameters
                var defaults = new object[parameters.Length];
                for (var i = 0; i < parameters.Length; i++)
                {
                    defaults[i] = parameters[i].HasDefaultValue ? parameters[i].DefaultValue : GetDefault(parameters[i].ParameterType);
                }
                converted = defaults;
                return true;
            }

            var args = new object[parameters.Length];
            for (var i = 0; i < parameters.Length; i++)
            {
                if (i < rawArgs.Length && rawArgs[i] != null)
                {
                    if (!TryConvertArg(rawArgs[i], parameters[i].ParameterType, out var value, out var argScore))
                        return false;
                    args[i] = value;
                    score += argScore;
                }
                else if (parameters[i].HasDefaultValue)
                {
                    args[i] = parameters[i].DefaultValue;
                }
                else
                {
                    args[i] = GetDefault(parameters[i].ParameterType);
                }
            }
            converted = args;
            return true;
        }

        private static bool TryConvertArg(object value, Type targetType, out object converted, out int score)
        {
            score = 0;
            converted = null;

            if (value == null)
            {
                converted = GetDefault(targetType);
                return true;
            }

            if (value is JsonElement jsonElement)
            {
                try
                {
                    converted = ConvertJsonElement(jsonElement, targetType);
                    score = 2;
                    return true;
                }
                catch
                {
                    return false;
                }
            }

            if (targetType.IsInstanceOfType(value))
            {
                converted = value;
                score = 3;
                return true;
            }

            try
            {
                converted = Convert.ChangeType(value, targetType);
                score = 1;
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static object ConvertJsonElement(JsonElement element, Type targetType)
        {
            if (targetType == typeof(string))
                return element.ValueKind == JsonValueKind.Null ? null : element.ToString();

            if (targetType == typeof(int))
                return element.GetInt32();

            if (targetType == typeof(long))
                return element.GetInt64();

            if (targetType == typeof(double))
                return element.GetDouble();

            if (targetType == typeof(float))
                return (float)element.GetDouble();

            if (targetType == typeof(bool))
                return element.GetBoolean();

            if (targetType == typeof(object))
            {
                return element.ValueKind switch
                {
                    JsonValueKind.String => element.GetString(),
                    JsonValueKind.Number => element.TryGetInt64(out var l) ? (object)l : element.GetDouble(),
                    JsonValueKind.True => true,
                    JsonValueKind.False => false,
                    JsonValueKind.Null => null,
                    _ => element.GetRawText()
                };
            }

            // For complex types, deserialize
            return JsonSerializer.Deserialize(element.GetRawText(), targetType);
        }

        private static object GetDefault(Type type)
        {
            return type.IsValueType ? Activator.CreateInstance(type) : null;
        }

        private void SendResponse(string id, object result)
        {
            var response = new BridgeResponse { Id = id, Result = result };
            PostMessage(response);
        }

        private void SendError(string id, string error)
        {
            var response = new BridgeResponse { Id = id, Error = error };
            PostMessage(response);
        }

        public void SendEvent(string name, object data = null)
        {
            var evt = new BridgeEvent { Name = name, Data = data };
            PostMessage(evt);
        }

        private void PostMessage(object message)
        {
            if (_webView == null)
                return;

            try
            {
                var json = JsonSerializer.Serialize(message);
                _webView.PostWebMessageAsJson(json);
            }
            catch (Exception ex)
            {
                logger.Error(ex, "Error posting message to WebView2");
            }
        }
    }
}
