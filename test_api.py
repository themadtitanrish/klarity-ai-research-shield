import requests

url = "https://klarity-v1-0b02b4f0-13f3-4131-a72f-967225ee-601fcbd6.crewai.com/kickoff"
token = "6fdbe6dd5428"

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

body = {
    "inputs": {
        "research_topic": "protein content in crickets"
    }
}

response = requests.post(url, headers=headers, json=body)

print("Status code:", response.status_code)
print("Response:")
print(response.json())