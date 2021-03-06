const ChartjsNode = require('chartjs-node');
var request = require('request');
var fs = require('fs');
var steem = require('steem');
var utils = require('./utils');

var config = JSON.parse(fs.readFileSync("config.json"));
steem.api.setOptions({ url: config.steem_api });

if (global.CanvasGradient === undefined) {
  global.CanvasGradient = function() {};
}

const coins = [
    '1',
    '1027',
    '52',
    '2',
    '2010',
    '1376',
    '1765',
    '1230',
]

const symbols = {
    '1': 'BTC',
    '1027': 'ETH',
    '1230': 'STEEM',
    '2': 'LTC',
    '52': 'XRP',
    '2010': 'ADA',
    '1376': 'NEO',
    '1765': 'EOS',
}

const backgroundMapping = {
    '1': 'rgba(255, 99, 132, 0.2)',
    '1027': 'rgba(54, 162, 235, 0.2)',
    '2': 'rgba(123, 201, 237, 0.2)',
    '1230': 'rgba(255, 206, 86, 0.2)',
    '52': 'rgba(75, 192, 192, 0.2)',
    '2010': 'rgba(153, 102, 255, 0.2)',
    '1376': 'rgba(255, 159, 64, 0.2)',
    '1765': 'rgba(34, 47, 62, 0.2)'
}

const borderMapping = {
    '1': 'rgba(255, 99, 132, 1)',
    '1027': 'rgba(54, 162, 235, 1)',
    '2': 'rgba(123, 201, 237, 1)',
    '1230': 'rgba(255, 206, 86, 1)',
    '52': 'rgba(75, 192, 192, 1)',
    '2010': 'rgba(153, 102, 255, 1)',
    '1376': 'rgba(255, 159, 64, 1)',
    '1765': 'rgba(34, 47, 62, 1)'
}

init();

function init() {
    const timestamp = Date.now();
    var coindata = {};
    var imageNames = {};

    var indexUploaded = 0;
    coins.forEach((coin) => {
        getCoinData(coin, function(err, res) {
            if (err !== null) {
                console.log(err);
                return;
            }

            coindata[coin] = {
                data: JSON.parse(res).data,
                image: null
            };

            getHistoricalData(symbols[coin], function(err, result) {
                if (err !== null) {
                    console.log(err);
                    return;
                }

                const histoday = JSON.parse(result).Data;
                const graphdata = generateGraphData(histoday, coin);

                createChartImage(coin + timestamp, {
                    labels: getLabels(1440),
                    datasets: [graphdata]
                }, 'line', false, symbols[coin], {width: 1280, height: 800}, function() {
                    imageNames[coin] = coin + timestamp;

                    indexUploaded++;
                    if (indexUploaded === coins.length) {
                        var dataset = [];
                        coins.forEach((coin) => {
                            dataset.push({
                                label: coin,
                                data: [coindata[coin].data.quotes.USD.percent_change_7d],
                                backgroundColor: [backgroundMapping[coin]],
                                borderColor: [borderMapping[coin]],
                                borderWidth: 1
                            });
                        });
                        createChartImage('overall' + timestamp, {
                            datasets: dataset
                        }, 'bar', true, '7 Days Change', {width: 1280, height: 800}, function() {
                            uploadImageToBlockchain('overall' + timestamp, function(err, res) {
                                if (err) {
                                    console.log(err);
                                    return;
                                }

                                const imgURL = JSON.parse(res).data.url;
                                coindata['overall'] = {
                                    image: imgURL + '.png'
                                };

                                generateMarkdown(coindata, timestamp, imageNames);
                            });
                        });
                    }
                });
            });
        });
    });

}

function getLabels(amount) {
    labels = [];
    for (var i = 0; i < amount; i++) {
        labels.push('');
    }

    return labels;
}

function uploadImages(coindata, imageNames, index, callback) {
    if (coins.length <= index) {
        callback(coindata);
        return;
    }

    const coin = coins[index];
    const imageName = imageNames[coin];
    uploadImageToBlockchain(imageName, function(err, res) {
        if (err) {
            console.log(err);
            return;
        }

        const imgURL = JSON.parse(res).data.url;
        coindata[coin].image = imgURL + '.png';
        uploadImages(coindata, imageNames, index + 1, callback);
    });
}

function generateMarkdown(coinData, timestamp, imageNames) {
    uploadImages(coinData, imageNames, 0, function(coindata) {
        fs.readFile('templates/main.md', 'utf8', function (err, data) {
          if (err) throw err;

          data = data.replace(/{overall_graph}/g, '![overall_graph]('+ coindata['overall'].image +')');
          data = data.replace(/{date}/g, new Date().toDateString());

          getAllCoins(coindata, function(coins) {
              data = data.replace(/{coins}/g, coins.markdown);

              // Write Markdown File
              writeMarkdownFile(data, timestamp);

              const broadcastData = {
                  markdown: data,
                  links: coins.links,
                  images: [coindata['overall'].image].concat(coins.images)
              };

              broadcastToSteemBlockchain(broadcastData, timestamp);

              utils.clearImgFolder();
              utils.writeToStateJSON();
          });
        });
    });
}

function writeMarkdownFile(data) {
    fs.writeFile('./out/out.md', data, function(err) {
        if (err) throw err;

        console.log('Markdown generated!');
    });
}

function broadcastToSteemBlockchain(data, timestamp) {
    if (!config.should_post_to_steemit) {
        console.log('Not uploading to Steemit - Abort');
        return;
    }


    const json_metadata = {
        "tags": [
            "coin",
            "cryptocurrency",
            "bitcoin",
            "steem",
            "crypto"
        ],
        "links": data.links,
        "image": data.images,
        "format": "markdown",
        "app": "coinstats\/0.2"
    };

    steem.broadcast.comment(
        config.private_posting_key,
        '',
        'coin',
        config.account,
        timestamp + '-coinstats-daily-cryptocurrency-statistic-service',
        'CoinStats - A Cryptocurrency Statistic Service',
        data.markdown,
        json_metadata
    );
}

function getAllCoins(coindata, callback) {
    var coinFields = '';
    var indexGenerated = 0;

    var returnData = {
        links: [],
        images: ['https://spee.ch/9/titleheader.png', 'https://spee.ch/e/coinsheaders.png'],
        markdown: ''
    };

    coins.forEach((coin) => {
        generateCoinmarkdown(coindata[coin], function(data) {
            coinFields += data.markdown + '  ';

            returnData.links.push(data.link);
            returnData.images.push(coindata[coin].image);

            indexGenerated++;
            if (indexGenerated === coins.length) {
                returnData.markdown = coinFields;

                callback(returnData);
            }
        });
    });
}

function generateCoinmarkdown(coindata, callback) {
    fs.readFile('templates/coin.md', 'utf8', function (err, data) {
      if (err) throw err;

      data = data.replace(/{coin_name}/g, coindata.data.name);
      data = data.replace(/{coin_graph}/g, '![coin_graph]('+ coindata.image +')');

      data = data.replace(/{name}/g, coindata.data.name);
      data = data.replace(/{symbol}/g, coindata.data.symbol);
      data = data.replace(/{rank}/g, coindata.data.rank);
      data = data.replace(/{price}/g, coindata.data.quotes.USD.price);
      data = data.replace(/{change_1h}/g, coindata.data.quotes.USD.percent_change_1h);
      data = data.replace(/{change_24h}/g, coindata.data.quotes.USD.percent_change_24h);
      data = data.replace(/{change_7d}/g, coindata.data.quotes.USD.percent_change_7d);
      data = data.replace(/{market_cap}/g, coindata.data.quotes.USD.market_cap);
      data = data.replace(/{more}/g, '[Click here](https://coinmarketcap.com/currencies/'+ coindata.data.id +')');

      returnData = {
          markdown: data,
          link: 'https://coinmarketcap.com/currencies/'+ coindata.data.id
      };

      callback(returnData);
    });
}

function generateGraphData(histoData, coin) {
    var data = [];

    histoData.forEach((histo) => {
        data.push(Number(histo.close));
    });

    return {
        label: "24 Hours Value",
        data: data,
        backgroundColor: backgroundMapping[coin],
        borderColor: borderMapping[coin],
        fill: false,
        steppedLine: true,
        pointStyle: 'crossRot'
    };
}

function getCoinData(id, callback) {
    request('https://api.coinmarketcap.com/v2/ticker/' + id, function (error, response, body) {
        callback(error, body);
    });
}

function getHistoricalData(symbol, callback) {
    request('https://min-api.cryptocompare.com/data/histominute?fsym='+symbol+'&tsym=USD&limit=1440&e=CCCAGG', function (error, response, body) {
        callback(error, body);
    });
}

function uploadImageToBlockchain(imageName, callback) {
    request.post({url: 'https://spee.ch/api/claim/publish', formData: {name: imageName, file: fs.createReadStream('./img/'+ imageName +'.png')}}, function (error, response, body) {
        callback(error, body);
    });
}

function createChartImage(imageName, chartDataSet, chartType, showPercentage, title, chartSize, callback) {
    const chartNode = new ChartjsNode(chartSize.width, chartSize.height);

    return chartNode.drawChart({
        type: chartType,
        data: chartDataSet,
        options: {
            title: {
                display: true,
                text: title
            },
            scales: {
                yAxes: [{
                    ticks: {
                        beginAtZero: false,
                        callback: function(value, index, values) {
                            if (showPercentage) {
                                return value + ' %';
                            }
                            return value.toLocaleString("en-US",{style:"currency", currency:"USD"});;
                        }
                    }
                }],
                xAxes: [{
                    gridLines: {
                        display:false
                    }
                }]
            }
        }
    })
    .then(() => {
        return chartNode.getImageBuffer('image/png');
    })
    .then(buffer => {
        return chartNode.getImageStream('image/png');
    })
    .then(streamResult => {
        streamResult.stream
        streamResult.length

        return chartNode.writeImageToFile('image/png', './img/'+ imageName +'.png');
    })
    .then(() => {
        chartNode.destroy();

        callback();
    });
}


module.exports = { init };