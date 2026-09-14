from flask import render_template, url_for, flash, redirect, send_from_directory
from flaskblog.forms import PostForm, LinkedInForm
from flaskblog import get_db_connection
from flaskblog import app
from flaskblog.portfolio_data import get_all_portfolio_data
import os, secrets
from moviepy import ImageClip


def upload_media(form_media):
    random_hex = secrets.token_hex(8)
    _, file_extension = os.path.splitext(form_media.filename)
    media_filename = random_hex + file_extension
    media_path = os.path.join(app.root_path, 'static/assets/uploaded_media/', media_filename)

    if file_extension in ['.jpg', '.png', '.jpeg']:
        clip = ImageClip(form_media)
        clip_resized = clip.resized(height=300)
        clip_resized.save_frame(media_path)

    return media_filename


def upload_document(form_file):
    """Save an uploaded document (e.g. the LinkedIn PDF) into
    static/assets/documents/ under a randomised name."""
    random_hex = secrets.token_hex(8)
    _, file_extension = os.path.splitext(form_file.filename)
    doc_filename = random_hex + file_extension
    doc_path = os.path.join(app.root_path, 'static/assets/documents/', doc_filename)
    form_file.save(doc_path)
    return doc_filename


def save_document_record(doc_key, filename):
    """Upsert a document record in the `documents` table. Fails soft."""
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute("""
            INSERT INTO documents (doc_key, filename)
            VALUES (%s, %s)
            ON CONFLICT (doc_key) DO UPDATE
            SET filename = EXCLUDED.filename,
                date_created = CURRENT_TIMESTAMP;
        """, (doc_key, filename))
        connection.commit()
        cursor.close()
        connection.close()
        return True
    except Exception:
        return False


def get_document_filename(doc_key):
    """Look up a stored document filename. Fails soft (returns None)."""
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute("SELECT filename FROM documents WHERE doc_key = %s;", (doc_key,))
        row = cursor.fetchone()
        cursor.close()
        connection.close()
        if row and row[0]:
            return row[0]
    except Exception:
        pass
    return None


def get_linkedin_pdf_url():
    """Static URL of the uploaded LinkedIn PDF, or '' if none stored yet."""
    filename = get_document_filename('linkedin_pdf')
    if filename:
        return url_for('static', filename='assets/documents/' + filename)
    return ''


def get_all_posts():
    """Every blog post as dicts (so templates can use post.title etc.).
    Fails soft — the homepage renders even if the DB is unreachable."""
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM posts ORDER BY id DESC;")
        columns = [desc[0] for desc in cursor.description]
        posts = [dict(zip(columns, row)) for row in cursor.fetchall()]
        cursor.close()
        connection.close()
        return posts
    except Exception:
        return []

@app.route('/')
def index():
    # Dual-mode portfolio data (GitHub API / resume.json / poems / art).
    # get_all_portfolio_data() fails soft: the homepage renders even when the
    # GitHub API is rate-limited or a content file is missing.
    data = get_all_portfolio_data()
    data["linkedin_pdf_url"] = get_linkedin_pdf_url()
    data["posts"] = get_all_posts()  # the blog lives on the creative side
    return render_template('index.html', **data)


@app.route('/blog')
def blog_page():
    """Standalone blog page — the journal proper lives on the creative side."""
    return render_template('blog.html', posts=get_all_posts())


@app.route('/art/<path:filename>')
def art_media(filename):
    """Serve creative-mode polaroid images from content/art/ (file-drop friendly)."""
    art_dir = os.path.join(os.path.dirname(app.root_path), 'content', 'art')
    return send_from_directory(art_dir, filename)


@app.route('/admin', methods=['GET', 'POST'])
def admin_page():
    form = PostForm()
    linkedin_form = LinkedInForm()
    media_file = ''
    if form.submit.data and form.validate_on_submit():
        if form.media.data:
            media_file = upload_media(form.media.data)
        
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute("""
            INSERT INTO posts (title, content, media) 
            VALUES (%s, %s, %s);
        """, (form.title.data, form.content.data, media_file))

        connection.commit()
        cursor.close()
        connection.close()

        flash(f'Post Successfully uploaded!', 'success')
        return redirect(url_for('index') + '#journal')

    if linkedin_form.submit.data and linkedin_form.validate_on_submit():
        if linkedin_form.linkedin_pdf.data:
            filename = upload_document(linkedin_form.linkedin_pdf.data)
            if save_document_record('linkedin_pdf', filename):
                flash('LinkedIn PDF uploaded! It now serves at /linkedin.', 'success')
            else:
                flash('PDF saved, but the database record could not be updated.', 'danger')
        return redirect(url_for('admin_page'))
    return render_template('admin.html', form=form, linkedin_form=linkedin_form)


@app.route('/linkedin')
def linkedin_page():
    """Serve the uploaded LinkedIn profile PDF; fall back to the live page."""
    filename = get_document_filename('linkedin_pdf')
    if filename:
        docs_dir = os.path.join(app.root_path, 'static/assets/documents/')
        return send_from_directory(docs_dir, filename)
    return redirect('https://www.linkedin.com/in/jola-amodu/')