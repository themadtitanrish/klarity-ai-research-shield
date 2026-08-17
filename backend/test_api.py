import requests

url = "https://klarity-ai-research-shield.onrender.com/validate"

topic = input("Enter your research topic: ")

body = {
    "topic": topic
}

response = requests.post(url, json=body)

print("\nStatus code:", response.status_code)
print("\nKlarity result:")
print(response.json())