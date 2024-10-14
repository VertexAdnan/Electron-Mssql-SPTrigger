```
Example dbconfig.json
{
    "databases": [
      {
        "name": "db1",
        "config": {
          "user": "sa",
          "password": "strongpassword",
          "server": "localhost",
          "database": "warz1",
          "options": {
            "encrypt": true,
            "trustServerCertificate": true,
            "requestTimeout": 1200000000, // For largest SP
            "validateConnection": false
          }
        }
      }
    ]
  }
```
You can use multiple databases working parallel
