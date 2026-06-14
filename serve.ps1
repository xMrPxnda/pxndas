$prefix = 'http://localhost:8000/'
$root = 'C:\Users\braed\Downloads\ee'
$dataDir = Join-Path $root 'data'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "pxndas server at $prefix"
Write-Host "Press Ctrl+C to stop."

$mime = @{
    '.html' = 'text/html'; '.css' = 'text/css'; '.js' = 'application/javascript'
    '.json' = 'application/json'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
    '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'; '.svg' = 'image/svg+xml'
    '.ico' = 'image/x-icon'
}

function Add-CorsHeaders($res) {
    $res.Headers.Add('Access-Control-Allow-Origin', '*')
    $res.Headers.Add('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    $res.Headers.Add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function Send-Json($res, $data) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($data)
    $res.ContentType = 'application/json'
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.OutputStream.Close()
}

function Send-Error($res, $msg, $code=400) {
    $res.StatusCode = $code
    Send-Json $res "{`"ok`":false,`"error`":`"$($msg -replace '"','\"')`"}"
}

function Get-SafePath($key) {
    # Sanitize key to prevent path traversal
    $safe = $key -replace '[^a-zA-Z0-9_\-]', ''
    return Join-Path $dataDir "$safe.json"
}

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response
    Add-CorsHeaders $res

    # CORS preflight
    if ($req.HttpMethod -eq 'OPTIONS') {
        $res.StatusCode = 204
        $res.OutputStream.Close()
        continue
    }

    $path = $req.Url.AbsolutePath.TrimStart('/')
    $method = $req.HttpMethod

    # --- API Proxy ---
    if ($path -eq 'api/chat' -and $method -eq 'POST') {
        $reader = New-Object System.IO.StreamReader($req.InputStream)
        $body = $reader.ReadToEnd()
        $reader.Close()
        $json = $body | ConvertFrom-Json

        $provider = $json.provider
        $apiKey = $json.apiKey
        $model = $json.model
        $query = $json.query
        $contextMsg = $json.context
        $history = $json.history

        try {
            if ($provider -eq 'gemini') {
                $contents = @()
                $firstUserMsg = $true
                if ($history) {
                    foreach ($msg in $history) {
                        if ($msg.role -eq 'system') {
                            if ($firstUserMsg) { $contextMsg = "$($msg.content)" } else { $contextMsg = "$($msg.content)`n---" }
                        } elseif ($msg.role -eq 'assistant') {
                            $contents += @{ role = 'model'; parts = @(@{ text = $msg.content }) }
                        } elseif ($msg.role -eq 'user') {
                            $text = if ($firstUserMsg -and $contextMsg) { "$contextMsg`n`n$($msg.content)" } else { $msg.content }
                            $contents += @{ role = 'user'; parts = @(@{ text = $text }) }
                            $firstUserMsg = $false
                        }
                    }
                } else {
                    $fullQuery = "$contextMsg`n`nAdmin: $query"
                    $contents = @(@{ parts = @(@{ text = $fullQuery }) })
                }
                $url = "https://generativelanguage.googleapis.com/v1beta/models/$($model):generateContent?key=$apiKey"
                $payload = @{
                    contents = $contents
                    generationConfig = @{ maxOutputTokens = 1024; temperature = 0.7 }
                } | ConvertTo-Json -Depth 10

                $geminiRes = Invoke-WebRequest -Uri $url -Method POST -Body $payload -ContentType 'application/json' -UseBasicParsing
                if ($geminiRes.StatusCode -ge 200 -and $geminiRes.StatusCode -lt 300) {
                    $jsonResp = $geminiRes.Content | ConvertFrom-Json
                    $reply = $jsonResp.candidates[0].content.parts[0].text
                } else { throw "Gemini API $($geminiRes.StatusCode): $($geminiRes.Content)" }
            }
            else {
                $url = 'https://openrouter.ai/api/v1/chat/completions'
                if (-not $history -or $history.Count -eq 0) {
                    $history = @(@{ role = 'system'; content = $contextMsg }, @{ role = 'user'; content = $query })
                }
                $payload = @{
                    model = $model
                    messages = $history
                    max_tokens = 1024; temperature = 0.7
                } | ConvertTo-Json -Depth 10

                $headers = @{ 'Authorization' = "Bearer $apiKey"; 'Content-Type' = 'application/json' }
                $orRes = Invoke-WebRequest -Uri $url -Method POST -Body $payload -ContentType 'application/json' -Headers $headers -UseBasicParsing
                if ($orRes.StatusCode -ge 200 -and $orRes.StatusCode -lt 300) {
                    $jsonResp = $orRes.Content | ConvertFrom-Json
                    $reply = $jsonResp.choices[0].message.content
                } else { throw "OpenRouter API $($orRes.StatusCode): $($orRes.Content)" }
            }

            Send-Json $res "{`"ok`":true,`"reply`":`"$($reply -replace '"','\"' -replace "`n",'\n' -replace "`r",'')`"}"
        }
        catch {
            $errMsg = $_.Exception.Message
            if ($_.Exception.Response) {
                try {
                    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                    $bodyText = $reader.ReadToEnd()
                    $reader.Close()
                    $errMsg = "$errMsg`n$bodyText"
                } catch {}
            }
            Send-Error $res $errMsg 500
        }
        continue
    }

    # --- Data API ---
    if ($path -match '^api/data/([a-zA-Z0-9_\-]+)$') {
        $key = $matches[1]
        $filePath = Get-SafePath $key

        if ($method -eq 'GET') {
            if (Test-Path $filePath) {
                $content = Get-Content $filePath -Raw -Encoding UTF8
                Send-Json $res "{`"ok`":true,`"data`":$content}"
            } else {
                # Return null for missing keys (treat as empty)
                Send-Json $res "{`"ok`":true,`"data`":null}"
            }
        }
        elseif ($method -eq 'POST') {
            $reader = New-Object System.IO.StreamReader($req.InputStream)
            $body = $reader.ReadToEnd()
            $reader.Close()

            try {
                # Validate it's valid JSON
                $null = $body | ConvertFrom-Json
                # Handle null value
                if ($body -eq 'null') {
                    [System.IO.File]::WriteAllText($filePath, 'null', [System.Text.Encoding]::UTF8)
                } else {
                    # Pretty-print and save
                    $formatted = $body | ConvertFrom-Json | ConvertTo-Json -Depth 10
                    [System.IO.File]::WriteAllText($filePath, $formatted, [System.Text.Encoding]::UTF8)
                }
                Send-Json $res "{`"ok`":true}"
            } catch {
                Send-Error $res "Invalid JSON" 400
            }
        }
        else {
            Send-Error $res "Method not allowed" 405
        }
        continue
    }

    # --- Serve static files ---
    if ([string]::IsNullOrEmpty($path)) { $path = 'index.html' }
    $filePath = Join-Path $root $path

    if (Test-Path $filePath -PathType Leaf) {
        $content = [System.IO.File]::ReadAllBytes($filePath)
        $ext = [System.IO.Path]::GetExtension($filePath)
        $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $res.ContentLength64 = $content.Length
        $res.OutputStream.Write($content, 0, $content.Length)
    } else {
        $res.StatusCode = 404
        $err = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
        $res.OutputStream.Write($err, 0, $err.Length)
    }
    $res.OutputStream.Close()
}
