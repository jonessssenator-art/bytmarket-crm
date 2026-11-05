// Brand adapter for the Print 360 shell. The approved logo is kept intact.
export default function Wordmark({mark=false,height=24,color='currentColor',title='БытМаркет'}) {
 if(mark)return <span aria-label={title||undefined} style={{fontFamily:'Manrope,sans-serif',fontSize:height+5,fontWeight:800,lineHeight:1,color}}>Б</span>;
 return <img src="/assets/logo.png" alt={title} className="bm-wordmark" style={{height:height+15,width:'auto',maxWidth:194,objectFit:'contain',background:'#fff',borderRadius:7,padding:'3px 7px'}}/>;
}
