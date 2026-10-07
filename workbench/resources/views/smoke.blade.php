<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Footprint smoke</title>
    <style>
        body { margin: 0; font: 16px/1.4 system-ui, sans-serif; }
        [data-footprint-section] { height: 900px; border-bottom: 1px solid #ccc; }
    </style>
    @footprint
</head>
<body>
    <main>
        <div data-footprint-section="s1"><button id="cta">Build yours</button> <a id="link" href="/orders/Xk9fQ2LmP0aZ7bR4tY1uW8eV3sD6gH5jN2kL9mQ0?paid=1">Your order</a></div>
        <div data-footprint-section="s2"><form name="quote"><input name="email" type="email"></form></div>
        <div data-footprint-section="s3">Three</div>
        <div data-footprint-section="s4">Four</div>
    </main>
    <script>
        document.getElementById('link').addEventListener('click', (event) => event.preventDefault());
    </script>
</body>
</html>
