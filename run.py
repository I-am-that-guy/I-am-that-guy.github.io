from flaskblog import app
from flaskblog.models import create_posts_table, create_documents_table

if __name__ == '__main__':

    with app.app_context():
        create_posts_table()
        try:
            create_documents_table()
        except Exception as exc:  # the site must still boot if the DB hiccups
            print(f"[warn] could not create documents table: {exc}")

    app.run(debug=True)
