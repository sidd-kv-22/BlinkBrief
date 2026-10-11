from flask import Flask, render_template, request, jsonify
import pyphen

app = Flask(__name__)
dic = pyphen.Pyphen(lang='en')

# Dummy database tracking mastery stage per word pattern
user_mastery = {}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/diagnose', methods=['POST'])
def diagnose():
    data = request.json
    word = data.get('word', '').strip()
    
    if not word:
        return jsonify({'status': 'error', 'message': 'No word provided'}), 400

    # Clean word punctuation
    clean_word = "".join([c for c in word if c.isalpha()])
    
    # Check mastery level
    current_stage = user_mastery.get(clean_word.lower(), 1)
    
    # Cause-Aware Logic
    # 1. Phonetic Decoding (Long/Complex words)
    if len(clean_word) >= 7:
        syllables = dic.inserted(clean_word)
        intervention_type = "phonetic"
        payload = {"syllables": syllables.replace("-", " · ")}
    # 2. Vocabulary Help (Short/Obscure words)
    else:
        intervention_type = "vocabulary"
        payload = {"definition": f"Simple meaning for '{clean_word}' in this context."}
    
    # Update mock mastery tracker (increment interaction count)
    user_mastery[clean_word.lower()] = current_stage + 1
    
    return jsonify({
        'word': clean_word,
        'type': intervention_type,
        'payload': payload,
        'stage': current_stage
    })

if __name__ == '__main__':
    print("Starting BlinkBrief Local Server on http://127.0.0.1:5000")
    app.run(debug=True)