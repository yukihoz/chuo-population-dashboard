# 中央区人口ダッシュボード

中央区が公開している月別Excelを取り込み、町丁目別の人口・世帯数推移と年齢構成を表示する静的Webアプリです。

## データ生成

```bash
python3 scripts/build_dataset.py --since-year 1998
```

生成物:

- `data/raw/`: ダウンロードしたExcel
- `data/chuo_population.json`: ダッシュボード用に正規化したJSON

## 表示

静的ファイルですが、ブラウザの `fetch()` でJSONを読むためローカルサーバー経由で開きます。

```bash
python3 -m http.server 8000
```

その後、<http://localhost:8000/> を開きます。

## GitHub Pages

このリポジトリは静的サイトとしてそのまま GitHub Pages に公開できます。公開対象はリポジトリルートです。

公開に必要なファイル:

- `index.html`
- `styles.css`
- `app.js`
- `data/chuo_population.json`
- `.nojekyll`

`data/raw/` は元Excelのキャッシュなので公開対象から除外しています。

## 現在の取り込み範囲

既定では1998年以降の `.xls` / `.xlsx` を対象にしています。古い年の国籍別がない年齢別データは、総数・男女別のみを使って正規化しています。
