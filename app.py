from flask import Flask, render_template, request
from aiogram import Bot
import asyncio
import random
import webbrowser
from threading import Timer

app = Flask(__name__)

# Substitua pelo seu token de bot do Telegram
TOKEN = "7033829689:AAEALHbSQC05FyQE2nai_Jst6t0xbTSXJBM"
bot = Bot(token=TOKEN)

@app.route('/')
def index():
    print("Página inicial carregada")
    return '''
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Autenticação por Telegram</title>
        </head>
        <body>
            <h1>Autenticação por Telegram</h1>
            <form action="/send_code" method="post">
                <label for="phone">Número do Telegram:</label>
                <input type="text" id="phone" name="phone" placeholder="+5511998765432" required>
                <button type="submit">Enviar Código</button>
            </form>
        </body>
        </html>
    '''

@app.route('/send_code', methods=['POST'])
async def send_code():
    phone_number = request.form['phone']
    
    # Gerando um código de verificação de 6 dígitos
    code = random.randint(100000, 999999)
    
    try:
        # Enviando o código para o Telegram usando await
        print(f"Enviando código {code} para {phone_number}...")
        await bot.send_message(chat_id=phone_number, text=f"Seu código de verificação é: {code}")
        print("Código enviado com sucesso!")
        return f"Código enviado para {phone_number}. Verifique seu Telegram!"
    except Exception as e:
        print(f"Erro ao enviar o código: {str(e)}")
        return f"Erro ao enviar o código: {str(e)}"

def open_browser():
    webbrowser.open_new("http://127.0.0.1:5000")

if __name__ == "__main__":
    print("Servidor iniciado em http://127.0.0.1:5000")
    Timer(1, open_browser).start()  # Aguarda 1 segundo e abre o navegador
    asyncio.run(app.run(debug=True, host='127.0.0.1', port=5000))